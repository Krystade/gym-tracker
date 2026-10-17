// Every outbound request (Google's keys, the push services) goes through here, so tests can stand in for the network.
export const net = {
  fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> => fetch(input, init),
};
