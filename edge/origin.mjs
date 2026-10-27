/** Prevent cross-site WebSocket hijacking, including mismatched scheme and host. */
export function isAllowedSocketOrigin(request) {
 try {
  const expected=new URL(request.url);
  const origin=request.headers.get('Origin');
  if(!origin || origin==='null')return false;
  const parsed=new URL(origin);
  if(parsed.origin!==expected.origin)return false;
  if(expected.protocol!=='https:' && expected.hostname!=='localhost' && expected.hostname!=='127.0.0.1')return false;
  return request.headers.get('Sec-Fetch-Site')!=='cross-site';
 } catch {return false;}
}
