// Vercel Serverless Function: read-only character lookup for AION2.
// This relies on publicly accessible but undocumented/community-observed PlayNC endpoints.
const BASE = 'https://aion2.plaync.com';
let cachedServers = null;
let cachedAt = 0;

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'Referer': BASE + '/' } });
  if (!response.ok) throw new Error(`게임 API 응답 오류 (${response.status})`);
  return response.json();
}
function collectServers(node, out=[]) {
  if (!node) return out;
  if (Array.isArray(node)) { for (const x of node) collectServers(x,out); return out; }
  if (typeof node === 'object') {
    const id = node.serverId ?? node.id;
    const name = node.serverName ?? node.server_name ?? node.name ?? node.text;
    if (id !== undefined && typeof name === 'string') out.push({ id: Number(id), name, raceId: Number(node.raceId ?? node.race ?? 0) });
    for (const [k,v] of Object.entries(node)) if (typeof v === 'object') collectServers(v,out);
  }
  return out;
}
async function findServer(serverName) {
  if (!cachedServers || Date.now()-cachedAt > 30*60*1000) {
    const data = await getJson(BASE + '/api/gameinfo/servers');
    cachedServers = collectServers(data).filter((s,i,a)=>Number.isFinite(s.id)&&a.findIndex(x=>x.id===s.id&&x.name===s.name)===i);
    cachedAt = Date.now();
  }
  const wanted = serverName.trim().toLocaleLowerCase('ko');
  const matches = cachedServers.filter(s=>s.name.trim().toLocaleLowerCase('ko')===wanted || s.name.replace(/\s/g,'').toLocaleLowerCase('ko')===wanted.replace(/\s/g,''));
  if (!matches.length) throw new Error(`서버 목록에서 '${serverName}'을 찾지 못했습니다. 서버 목록 API 형식이 변경됐을 수 있습니다.`);
  return matches[0];
}
function cleanName(v) { return String(v ?? '').replace(/<[^>]*>/g,'').trim(); }
async function lookup(name, server) {
  const races = server.raceId ? [server.raceId] : [1,2];
  let match = null;
  for (const race of races) {
    const url = BASE + '/ko-kr/api/search/aion2/search/v2/character?keyword=' + encodeURIComponent(name) + '&race=' + race + '&serverId=' + server.id;
    const result = await getJson(url);
    const list = Array.isArray(result.list) ? result.list : [];
    match = list.find(x => cleanName(x.name).toLocaleLowerCase('ko') === name.toLocaleLowerCase('ko'));
    if (match) break;
  }
  if (!match || !match.characterId) throw new Error('캐릭터 검색 결과 없음');
  const characterId = String(match.characterId);
  const info = await getJson(BASE + '/api/character/info?lang=ko&characterId=' + encodeURIComponent(characterId) + '&serverId=' + server.id);
  const profile = info.profile || {};
  const nameFromProfile = cleanName(profile.characterName || profile.name || match.name || name);
  const power = Number(profile.combatPower ?? profile.combat_power ?? 0) || 0;
  const level = Number(profile.characterLevel ?? profile.level ?? match.level ?? 0) || 0;
  const cls = cleanName(profile.className || profile.class_name || '기타') || '기타';
  const legion = cleanName(profile.legionName || profile.legion || profile.legion_name || '');
  return { name:nameFromProfile, cls, power, level, server:server.name, legion };
}
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'POST 요청만 지원합니다.'});
  const name = String(req.body?.name || '').trim();
  const serverName = String(req.body?.serverName || '바바룽').trim();
  if (!name || name.length > 30) return res.status(400).json({ok:false,error:'캐릭터 이름을 확인해 주세요.'});
  try {
    const server = await findServer(serverName);
    const character = await lookup(name, server);
    return res.status(200).json({ok:true,character});
  } catch (e) {
    return res.status(502).json({ok:false,error:e.message || '캐릭터 정보를 가져오지 못했습니다.'});
  }
};
