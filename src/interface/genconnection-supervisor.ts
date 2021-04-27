import { ConnectionOptions, createConnections, Connection } from "typeorm";
import { GenSupervisor } from "torrjs-core/src/interfaces/gensupervisor";
import { GenServer } from "torrjs-core/src/interfaces/genserver";
import { GenRegistry } from "torrjs-core/src/interfaces/genregistry";
import {
  RestartStrategy,
  ChildSpec,
  ChildRestartStrategy,
} from "torrjs-core/src/supervision/types";
import EventEmitter from "events";
import {
  keyForCombinedSelfReadable,
  keyForCombinedAdministrationSelfReadable,
  keyForSupervisedChidren,
  keyForIdSymbol,
} from "torrjs-core/src/utils/symbols";
import { CombineEmitter } from "torrjs-core/src/transports/combine-emitter";
import {
  memo,
  combineMemos,
  getMemoPromise,
  tail,
  putMemoValue,
} from "torrjs-core/src/utils";
import { keyForConnectionsOptions } from "../utils/symbols";
import { GenConnection } from "../impl/genconnection";

abstract class GenConnectionSupervisor extends GenSupervisor {
  private static [keyForConnectionsOptions]: ConnectionOptions[] | undefined;
  protected abstract children(): AsyncGenerator<
    unknown,
    (typeof GenRegistry & (new () => GenRegistry))[],
    unknown
  >;
  public async *start<
    U extends typeof GenServer,
    V extends typeof GenConnectionSupervisor
  >(
    startArgs: [RestartStrategy],
    context: U,
    canceler: Generator<[boolean, EventEmitter], never, boolean>,
    _cancelerPromise: Promise<boolean>
  ) {
    [
      context.eventEmitter,
      ...context.externalEventEmitters.values(),
    ].forEach((emitter) => emitter.resetInternalStreams());
    const combinableStreams = [
      context.eventEmitter,
      ...context.externalEventEmitters.values(),
    ].map((emitter) => {
      const stream = new (emitter.getInternalStreamType())();
      emitter.setStream(context.name, stream);
      return stream;
    });
    const combinableAdministrationStreams = [
      context.eventEmitter,
      ...context.externalEventEmitters.values(),
    ].map((emitter) => {
      const administrationStream = new (emitter.getInternalStreamType())();
      emitter.setStream(`${context.name}_management`, administrationStream);
      return administrationStream;
    });
    this[keyForCombinedSelfReadable] = new CombineEmitter(combinableStreams);
    this[keyForCombinedAdministrationSelfReadable] = new CombineEmitter(
      combinableAdministrationStreams
    );
    const managementCanceler = memo(true);
    const combinedCanceler = combineMemos(
      (...states) => states.reduce((acc, curr) => acc && curr, true),
      managementCanceler,
      canceler
    );
    const combinedCancelerPromise = getMemoPromise(combinedCanceler);
    const childRegistries: [
      typeof GenRegistry,
      GenRegistry,
      ChildSpec,
      Generator<[boolean, EventEmitter], never, boolean>
    ][] = yield* this.init();
    const connections: Connection[] = await ((<V>(<unknown>context))[
      keyForConnectionsOptions
    ]
      ? createConnections((<V>(<unknown>context))[keyForConnectionsOptions])
      : createConnections());

    const childConnectionServers: [
      typeof GenConnection,
      GenConnection,
      ChildSpec,
      Generator<[boolean, EventEmitter], never, boolean>
    ][] = [];
    for (const connection of connections) {
      childConnectionServers.push([
        GenConnection,
        new GenConnection(),
        { restart: ChildRestartStrategy.PERMANENT, startArgs: [connection] },
        memo(true),
      ]);
    }
    this[keyForSupervisedChidren] = childRegistries
      .concat(<any[]>childConnectionServers)
      .map(
        (
          childSpecs: [
            typeof GenServer,
            GenServer,
            ChildSpec,
            Generator<[boolean, EventEmitter], never, boolean>
          ]
        ) => ({
          id: childSpecs[1][keyForIdSymbol],
          canceler: childSpecs[3],
        })
      );

    combinedCancelerPromise.then((_) => {
      connections.forEach((connection) => connection.close());
    });
    for (const [registry] of childRegistries) {
      for (const [
        connectionServer,
        serverInstance,
        spec,
      ] of childConnectionServers) {
        yield* registry.register(
          [registry],
          (<Connection[]>spec.startArgs)[0].name,
          serverInstance[keyForIdSymbol]
        );
      }
    }
    await Promise.all([
      tail(
        (specs) =>
          this.run(
            combinedCanceler,
            combinedCancelerPromise,
            context,
            this[keyForSupervisedChidren],
            specs
          ),
        canceler,
        {
          childSpecs: <
            [
              typeof GenServer,
              GenServer,
              ChildSpec,
              Generator<[boolean, EventEmitter], never, boolean>
            ][]
          >childRegistries.concat(<any[]>childConnectionServers),
          strategy: startArgs[0],
        },
        (specs) => specs.childSpecs.length === 0
      ).then((value) => (putMemoValue(managementCanceler, false), value)),
      tail(
        () =>
          this.runManagement(
            managementCanceler,
            combinedCancelerPromise,
            context
          ),
        combinedCanceler,
        null,
        (exitValue) => exitValue === undefined
      ),
    ]);
  }
}

export { GenConnectionSupervisor };
