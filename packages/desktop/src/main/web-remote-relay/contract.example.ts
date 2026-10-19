import { createNodeWebRemoteControlRelayAuthProvider } from "./index.js";
const provider = createNodeWebRemoteControlRelayAuthProvider();
export const pairingProof = provider.calculateProof(
  "example-hash",
  "example-nonce",
  "device",
  "example-sid",
);
