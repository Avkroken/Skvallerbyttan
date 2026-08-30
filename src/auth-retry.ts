export async function retryOnceAfterUnauthorized(
  getToken: () => Promise<string>,
  refreshToken: (rejectedToken: string) => Promise<string>,
  request: (token: string) => Promise<Response>,
): Promise<Response> {
  let token = await getToken();
  let response = await request(token);
  if (response.status !== 401) return response;

  token = await refreshToken(token);
  response = await request(token);
  return response;
}
