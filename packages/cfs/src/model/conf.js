const { getTablePrefix } = require('@tigojs/utils');

const define = function (app, engine) {
  const prefix = getTablePrefix(app);
  const { INTEGER, STRING } = engine.Sequelize;

  const Config = engine.define('storedConfig', {
    uid: {
      type: INTEGER,
    },
    name: {
      type: STRING,
    },
    type: {
      type: STRING,
    },
  }, {
    tableName: `${prefix}_stored_config`,
  });

  Config.exists = async function (uid, type, name) {
    const item = await this.findOne({
      where: {
        uid,
        name,
        type,
      },
    });
    return !!item;
  }

  return Config;
}

module.exports = define;
