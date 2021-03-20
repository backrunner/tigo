const path = require('path');
const LRU = require('lru-cache');
const { NodeVM } = require('vm2');
const { BaseService } = require('@tigojs/core');
const { createContextProxy } = require('../utils/context');
const { stackFilter } = require('../utils/stackFilter');
const { getStorageKey, getEnvStorageKey } = require('../utils/storage');
const allowList = require('../constants/allowList');

const exportTester = /(\n+)?(\s+)?module\.exports(\s+)?=(\s+)?handleRequest(;+)?/;
const handleFuncTester = /async(\s+)?function(\s+)?handleRequest(\s+)?\((\s+)?[a-zA-Z_][a-zA-Z0-9_]+(\s+)?\)/;

const getScriptContent = (content) => Buffer.from(content, 'base64').toString('utf-8');

const checkScriptContent = (ctx, content) => {
  if (!handleFuncTester.test(content)) {
    ctx.throw(400, '函数代码内缺少必要的 handleRequest 方法');
  }
  if (!exportTester.test(content)) {
    ctx.throw(400, '函数代码内缺少必要的导出');
  }
};

const generalCheck = async (ctx, id) => {
  const dbItem = await ctx.model.faas.script.findByPk(id);
  if (!dbItem) {
    ctx.throw(400, '找不到该函数');
  }
  if (dbItem.uid !== ctx.state.user.id) {
    ctx.throw(401, '无权访问');
  }
  return dbItem;
}

class ScriptService extends BaseService {
  constructor(app) {
    let { config } = app.config.plugins.faas;
    if (!config) {
      app.logger.warn('Cannot find configuration for FaaS plugin, use default options.');
      config = {};
    }
    let { cache: cacheConfig } = config;
    cacheConfig = cacheConfig || {};
    super(app);
    // set cache
    this.cache = new LRU({
      max: cacheConfig.max || 500,
      maxAge: cacheConfig.maxAge || 60 * 60 * 1000,  // default max age is 1h,
      updateAgeOnGet: true,
    });
    this.scriptPathPrefix = path.resolve(app.rootDirPath, './lambda_userscript');
  }
  async exec(ctx, scopeId, name) {
    const cacheKey = `${scopeId}_${name}`;
    let handleRequestFunc = this.cache.get(cacheKey);
    if (!handleRequestFunc) {
      // func not in cache
      let script;
      try {
        script = await ctx.tigo.faas.storage.get(getStorageKey(scopeId, name));
      } catch (err) {
        if (err.notFound) {
          ctx.throw(400, '无法找到对应的函数');
        } else {
          throw err;
        }
      }
      const env = await ctx.tigo.faas.storage.getObject(getEnvStorageKey(scopeId, name));
      const vm = new NodeVM({
        eval: false,
        wasm: false,
        require: {
          external: {
            modules: [...allowList, ...ctx.tigo.faas.allowedRequire],
          },
        },
      });
      vm.freeze(env, 'SCRIPT_ENV');
      handleRequestFunc = vm.run(script, `${this.scriptPathPrefix}_${new Date().valueOf()}.js`);
      this.cache.set(cacheKey, handleRequestFunc);
    }
    const showStack = ctx.query.__tigoDebug === '1';
    try {
      await handleRequestFunc(createContextProxy(ctx));
    } catch (err) {
      err.stack = showStack ? stackFilter(err.stack) : null;
      err.fromFaas = true;
      throw err;
    }
  }
  async add(ctx) {
    const { name, content, env } = ctx.request.body;
    const { id: uid, scopeId } = ctx.state.user;
    // check content
    const scriptContent = getScriptContent(content);
    checkScriptContent(ctx, scriptContent);
    // check duplicate items
    if (await ctx.model.faas.script.hasName(uid, name)) {
      ctx.throw(400, '名称已被占用');
    }
    // write content to kv storage
    const key = getStorageKey(scopeId, name);
    await ctx.tigo.faas.storage.put(key, scriptContent);
    // save relation to db
    const script = await ctx.model.faas.script.create({
      uid: ctx.state.user.id,
      name,
    });
    // if env exists, add env to kv db
    if (env) {
      await ctx.tigo.faas.storage.putObject(getEnvStorageKey(scopeId, name), env);
    }
    return script.id;
  }
  async edit(ctx) {
    const { id, name, content } = ctx.request.body;
    const { id: uid, scopeId } = ctx.state.user;
    // check content
    const scriptContent = getScriptContent(content);
    checkScriptContent(ctx, scriptContent);
    // check db item
    const dbItem = await generalCheck(ctx, id);
    // if name changed, delete previous version in storage
    if (dbItem.name !== name) {
      if (await ctx.model.faas.script.hasName(uid, name)) {
        ctx.throw(400, '名称已被占用');
      }
      await ctx.tigo.faas.storage.del(getStorageKey(scopeId, dbItem.name));
      await ctx.model.faas.script.update({
        name,
      }, {
        where: {
          id,
        },
      });
      this.cache.del(`${scopeId}_${dbItem.name}`);
      // env
      const envKey = getEnvStorageKey(scopeId, dbItem.name);
      const env = await ctx.tigo.faas.storage.get(envKey);
      if (env) {
        await ctx.tigo.faas.storage.del(envKey);
        await ctx.tigo.faas.storage.putObject(getEnvStorageKey(scopeId, name), env);
      }
    } else {
      this.cache.del(`${scopeId}_${name}`);
    }
    // update script
    await ctx.tigo.faas.storage.put(getStorageKey(scopeId, name), scriptContent);
  }
  async rename(ctx) {
    const { id, newName } = ctx.request.body;
    const { id: uid, scopeId } = ctx.state.user;
    if (await ctx.model.faas.script.hasName(uid, newName)) {
      ctx.throw(400, '名称已被占用');
    }
    const dbItem = await generalCheck(ctx, id);
    await ctx.model.faas.script.update({
      name: newName,
    }, {
      where: {
        id,
      },
    });
    // script
    const oldKey = getStorageKey(scopeId, dbItem.name);
    const content = await ctx.tigo.faas.storage.get(oldKey);
    await ctx.tigo.faas.storage.del(oldKey);
    this.cache.del(`${scopeId}_${dbItem.name}`);
    await ctx.tigo.faas.storage.put(getStorageKey(scopeId, newName), content);
    // env
    const envKey = getEnvStorageKey(scopeId, dbItem.name);
    const env = await ctx.tigo.faas.storage.get(envKey);
    if (env) {
      await ctx.tigo.faas.storage.del(getStorageKey(envKey));
      await ctx.tigo.faas.storage.putObject(getEnvStorageKey(scopeId, newName), env);
    }
  }
  async delete(ctx) {
    const { id } = ctx.request.body;
    const { scopeId } = ctx.state.user;
    const dbItem = await generalCheck(ctx, id);
    await ctx.tigo.faas.storage.del(getEnvStorageKey(scopeId, dbItem.name));
    await ctx.tigo.faas.storage.del(getStorageKey(scopeId, dbItem.name));
    this.cache.del(`${scopeId}_${dbItem.name}`);
    await ctx.model.faas.script.destroy({
      where: {
        id,
      },
    });
  }
  async getContent(ctx) {
    const { id } = ctx.query;
    const { scopeId } = ctx.state.user;
    const dbItem = await generalCheck(ctx, id);
    return await ctx.tigo.faas.storage.get(getStorageKey(scopeId, dbItem.name));
  }
  deleteCache(key) {
    this.cache.del(key);
  }
}

module.exports = ScriptService;
