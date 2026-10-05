function retired() { return Response.json({error:'This version uses /api/v2. Refresh the website.',code:'API_RETIRED'},{status:410,headers:{'Cache-Control':'no-store'}}); }
export const GET=retired;
export const POST=retired;
