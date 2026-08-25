export class ChatRoomDO {
  state: any;
  env: any;

  constructor(state: any, env: any) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'active', message: 'ChatRoomDO Initialized' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
