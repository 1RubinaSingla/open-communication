import { io, type Socket } from "socket.io-client";
import { ORCH_URL } from "./config";

export function createInferSocket(token: string): Socket {
  return io(`${ORCH_URL}/infer`, {
    auth: { kind: "user", token },
    transports: ["polling", "websocket"],
  });
}

export function createCommsSocket(token: string): Socket {
  return io(`${ORCH_URL}/comms`, {
    auth: { kind: "user", token },
    transports: ["polling", "websocket"],
  });
}

/** Browser contributor: connects as a worker using the user's own token. */
export function createWorkerSocket(token: string): Socket {
  return io(`${ORCH_URL}/infer`, {
    auth: { kind: "worker", token },
    transports: ["polling", "websocket"],
  });
}
