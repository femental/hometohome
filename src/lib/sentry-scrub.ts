/** Sign-in URLs carry one-time tokens (`token_hash`, `code`): drop their query string before sending. */
export function stripAuthQuery<E extends { request?: { url?: string; query_string?: unknown } }>(event: E): E {
  const url = event.request?.url;
  if (url && /\/auth\//.test(url) && event.request) {
    event.request.url = url.split("?")[0];
    delete event.request.query_string;
  }
  return event;
}
