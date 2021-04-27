import { GenServer } from "torrjs-core/src/interfaces/genserver";
import { Connection } from "typeorm";
import { Server } from "torrjs-core/src/annotations/server";
import { InMemoryEmitter } from "torrjs-core/src/transports/in-memory-emitter";
import { ReplyTypes } from "torrjs-core/src/events/types";
import { handle } from "torrjs-core/src/annotations/handle";

@Server(new InMemoryEmitter(10_000))
class GenConnection extends GenServer {
  protected async *init(
    connection: Connection
  ): AsyncGenerator<unknown, Connection, unknown> {
    return connection;
  }

  @handle("getConnection")
  private async *handleGetConnection(connection: Connection) {
    return { type: ReplyTypes.REPLY, reply: connection, newState: connection };
  }

  public static async *getConnection<U extends GenServer>(
    serverId: string,
    self: U,
    timeout?: number
  ) {
    return yield* GenServer.call(
      [GenConnection, serverId],
      self,
      "getConnection",
      {},
      timeout
    );
  }
}

export { GenConnection };
