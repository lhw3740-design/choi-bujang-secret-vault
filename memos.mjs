// Vercel 서버 함수: GET /api/memos
// Supabase memos 테이블의 가상 메모를 읽어 화면에 돌려줍니다.
// 키는 서버 환경변수에서만 읽고, 응답과 로그에는 절대 넣지 않습니다.
// (.mjs 확장자라 package.json 설정과 관계없이 import/export 문법이 동작합니다.)

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "허용되지 않는 요청 방식입니다." });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    // 값은 찍지 않고, 어떤 설정이 빠졌는지만 남깁니다.
    console.error("memos: SUPABASE_URL 또는 SUPABASE_SECRET_KEY가 설정되지 않았습니다.");
    return res.status(500).json({ error: "서버 설정이 완료되지 않았습니다." });
  }

  try {
    const endpoint = new URL("/rest/v1/memos", supabaseUrl);
    endpoint.searchParams.set("select", "title,body");
    endpoint.searchParams.set("order", "created_at.asc");

    // 비밀 키는 apikey 헤더로만 보냅니다. 주소(URL)에는 넣지 않습니다.
    const upstream = await fetch(endpoint, {
      headers: { apikey: secretKey, Accept: "application/json" },
    });

    if (!upstream.ok) {
      // 상태 코드만 기록하고, Supabase가 돌려준 본문은 기록하지도 전달하지도 않습니다.
      console.error(`memos: Supabase가 오류를 돌려줬습니다 (상태 ${upstream.status}).`);
      return res.status(502).json({ error: "메모를 불러오지 못했습니다." });
    }

    const rows = await upstream.json();
    // owner_id 등 다른 칸은 내보내지 않고, 화면이 쓰던 data.json 모양(title, content)으로 맞춥니다.
    const notes = rows.map(({ title, body }) => ({ title, content: body }));
    return res.status(200).json({ notes });
  } catch {
    // 오류 객체는 기록하지 않습니다. 메시지에 요청 정보가 섞일 수 있기 때문입니다.
    console.error("memos: Supabase 요청 중 오류가 발생했습니다.");
    return res.status(502).json({ error: "메모를 불러오지 못했습니다." });
  }
}
