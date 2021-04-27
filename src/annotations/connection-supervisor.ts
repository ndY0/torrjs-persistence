import { TransportEmitter } from "torrjs-core/src/transports/interface";
import { GenConnectionSupervisor } from "../interface/genconnection-supervisor";
import { ConnectionOptions } from "typeorm";
import { keyForConnectionsOptions } from "../utils/symbols";

function ConnectionSupervisor(
  transport: TransportEmitter,
  connectionsOptions?: ConnectionOptions[],
  externalTransports?: { [key: string]: TransportEmitter } & {
    internal?: never;
  }
) {
  return <T extends typeof GenConnectionSupervisor>(constructor: T) => {
    Reflect.defineProperty(constructor, keyForConnectionsOptions, {
      configurable: false,
      enumerable: true,
      value: connectionsOptions,
      writable: false,
    });
    Reflect.defineProperty(constructor, "eventEmitter", {
      configurable: false,
      enumerable: false,
      value: transport,
      writable: false,
    });
    const externalTransportsMap: Map<string, TransportEmitter> = new Map();
    if (externalTransports) {
      Object.keys(externalTransports).forEach((key) => {
        externalTransportsMap.set(key, externalTransports[key]);
      });
    }
    Reflect.defineProperty(constructor, "externalEventEmitters", {
      configurable: false,
      enumerable: false,
      value: externalTransportsMap,
      writable: false,
    });
  };
}

export { ConnectionSupervisor };
