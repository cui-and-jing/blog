/**
 * Puppeteer page.goto() can resolve normally for HTTP 404/500 responses.
 * Treat only a successful navigation as a valid benchmark or visual fixture.
 */
export function assertSuccessfulNavigation(response, route, label = 'Browser route') {
  if (!response?.ok()) {
    throw new Error(`${label} ${route}: HTTP ${response?.status() ?? 'no response'}`);
  }
  return response;
}
