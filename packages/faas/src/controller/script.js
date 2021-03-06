const { BaseController } = require('@tigojs/core');
const { successResponse } = require('@tigojs/utils');

class ScriptController extends BaseController {
  getRoutes() {
    return {
      '/lambda/:scopeId/:name': {
        type: ['get', 'post', 'head', 'put', 'delete', 'patch'],
        target: this.handleExec,
        cors: false,
        external: true,
      },
      '/lambda/:scopeId/:name/*subPath': {
        type: ['get', 'post', 'head', 'put', 'delete', 'patch'],
        target: this.handleExec,
        cors: false,
        external: true,
      },
      // internal apis
      '/faas/list': {
        type: 'get',
        auth: true,
        target: this.handleList,
      },
      '/faas/getName': {
        type: 'get',
        auth: true,
        target: this.handleGetName,
      },
      '/faas/getContent': {
        type: 'get',
        auth: true,
        target: this.handleGetContent,
      },
      '/faas/rename': {
        type: 'post',
        auth: true,
        target: this.handleRename,
      },
      '/faas/save': {
        type: 'post',
        auth: true,
        target: this.handleSave,
        apiAccess: true,
      },
      '/faas/delete': {
        type: 'post',
        auth: true,
        target: this.handleDelete,
      },
    };
  }
  async handleList(ctx) {
    const list = await ctx.model.faas.script.findAll({
      where: {
        scopeId: ctx.state.user.scopeId,
      },
    });
    ctx.body = successResponse(list);
  }
  async handleGetName(ctx) {
    ctx.verifyParams({
      id: {
        type: 'string',
        required: true,
      },
    });
    ctx.body = successResponse(await ctx.service.faas.script.getName(ctx));
  }
  async handleGetContent(ctx) {
    ctx.verifyParams({
      id: {
        type: 'string',
        required: true,
      },
    });
    ctx.body = successResponse({
      content: Buffer.from(await ctx.service.faas.script.getContent(ctx), 'utf-8').toString('base64'),
    });
  }
  async handleExec(ctx) {
    const { scopeId, name } = ctx.params;
    await ctx.service.faas.script.exec(ctx, scopeId, name);
  }
  async handleSave(ctx) {
    ctx.verifyParams({
      action: {
        type: 'enum',
        values: ['add', 'edit'],
        required: true,
      },
      id: {
        type: 'string',
        required: false,
      },
      name: {
        type: 'string',
        required: true,
      },
      content: {
        type: 'string',
        required: true,
      },
      env: {
        type: 'object',
        required: false,
      },
      policy: {
        type: 'object',
        required: false,
      },
    });
    const { action } = ctx.request.body;
    if (action === 'add') {
      // add a new script
      const id = await ctx.service.faas.script.add(ctx);
      ctx.body = successResponse({
        id,
      }, '保存成功');
    } else if (action === 'edit') {
      // edit existed script
      await ctx.service.faas.script.edit(ctx);
      ctx.body = successResponse(null, '保存成功');
    }
  }
  async handleRename(ctx) {
    ctx.verifyParams({
      id: {
        type: 'string',
        required: true,
      },
      newName: {
        type: 'string',
        required: true,
      },
    });
    await ctx.service.faas.script.rename(ctx);
    ctx.body = successResponse(null, '修改成功');
  }
  async handleDelete(ctx) {
    ctx.verifyParams({
      id: {
        type: 'string',
        required: true,
      }
    });
    await ctx.service.faas.script.delete(ctx);
    ctx.body = successResponse(null, '删除成功');
  }
}

module.exports = ScriptController;
