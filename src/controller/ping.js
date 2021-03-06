const { BaseController } = require('@tigojs/core');

class PingController extends BaseController {
  getRoutes() {
    return {
      '/common/checkAvailable': {
        type: 'get',
        target: this.checkAvailable,
      },
      '/common/heartbeat': {
        type: 'get',
        target: this.heartbeat,
      },
      '/common/apiAccessCheck': {
        type: 'get',
        auth: true,
        apiAccess: true,
        target: this.apiAccessCheck,
      },
    };
  }
  async checkAvailable(ctx) {
    if (ctx.tigo.config.maintance) {
      ctx.throw(403, 'Server is under maintenance now.')
    }
    ctx.set('Content-Type', 'text/plain');
    ctx.body = 1;
  }
  async heartbeat(ctx) {
    ctx.set('Content-Type', 'text/plain');
    ctx.body = 1;
  }
  async apiAccessCheck(ctx) {
    ctx.set('Content-Type', 'text/plain');
    ctx.body = 1;
  }
}

module.exports = PingController;
