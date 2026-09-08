/* global ReviewDesk */
// Demo preview bootstrap. The reviewer secret lives in the URL fragment, which
// browsers never send to a server and never put in a Referer header.
const params = new URLSearchParams(location.hash.slice(1));
if (params.get('project') && params.get('review')) {
  ReviewDesk.init({
    api: params.get('api') || location.origin,
    projectId: params.get('project'),
    token: params.get('review'),
  });
}
