#!/usr/bin/env bash
# One-shot setup of the B&T English server bot on Supabase (steps 3–7 of supabase/README.md).
#
# Run from Git Bash in the repo root:   bash supabase/setup-bot.sh
#
# It asks for the secrets itself (hidden input) and never prints them: the Telegram token of a NEW bot made with
# @BotFather and, optionally, a Gemini API key. The two random secrets (webhook, scheduler) are generated here.
# Safe to run again: secrets are overwritten, SQL files are idempotent, functions are redeployed.
set -euo pipefail

cd "$(dirname "$0")/.."
NODE20="/c/Users/Admin/AppData/Roaming/nvm/v20.20.0"
[ -d "$NODE20" ] && export PATH="$NODE20:$PATH"
SB=(npx --yes supabase@3.0.0)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
umask 077

step() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail() {
  printf '\033[31m✗ %s\033[0m\n' "$*" >&2
  exit 1
}

# Telegram Bot API call without putting the token on the command line.
tg() {
  local method="$1" body="${2:-}"
  if [ -n "$body" ]; then
    printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$BOT_TOKEN" "$method" |
      curl -sS -K - -H 'content-type: application/json' --data "$body"
  else
    printf 'url = "https://api.telegram.org/bot%s/%s"\n' "$BOT_TOKEN" "$method" | curl -sS -K -
  fi
}
json_get() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));console.log(v??"")}catch{console.log("")}})' "$1"; }

# ---------------------------------------------------------------------------------------------------------------
step "1/8 Đăng nhập Supabase"
if "${SB[@]}" projects list >/dev/null 2>&1; then
  ok "Đã đăng nhập sẵn"
else
  echo "Trình duyệt sẽ mở để bạn đăng nhập Supabase và xác nhận."
  "${SB[@]}" login
fi

step "2/8 Chọn project"
"${SB[@]}" projects list || true
echo
read -rp "Dán URL project (https://xxxx.supabase.co) hoặc project ref: " REF_IN
REF="$(printf '%s' "$REF_IN" | sed -E 's#^https?://##; s#\.supabase\.co.*$##; s#[^a-z0-9]##g')"
[ -n "$REF" ] || fail "Thiếu project ref"
PROJECT_URL="https://$REF.supabase.co"
ok "Project: $PROJECT_URL"

[ -f supabase/config.toml ] || "${SB[@]}" init --yes >/dev/null
echo "Nếu được hỏi mật khẩu database, nhập mật khẩu đã đặt khi tạo project (hoặc Enter để bỏ qua)."
"${SB[@]}" link --project-ref "$REF"
ok "Đã liên kết project"

# ---------------------------------------------------------------------------------------------------------------
step "3/8 Bot Telegram cho server"
echo "Cần một bot MỚI (Telegram → @BotFather → /newbot), khác bot đang chạy trong app."
read -rsp "Dán token bot mới (không hiện ra khi gõ): " BOT_TOKEN
echo
ME="$(tg getMe)"
[ "$(printf '%s' "$ME" | json_get ok)" = "true" ] || fail "Token không hợp lệ: Telegram trả về $(printf '%s' "$ME" | json_get description)"
BOT_USERNAME="$(printf '%s' "$ME" | json_get result.username)"
ok "Bot: @$BOT_USERNAME"

read -rsp "Dán Gemini API key (Enter để bỏ qua – bot vẫn chạy nhưng không có AI): " GEMINI_KEY
echo
WEBHOOK_SECRET="$(openssl rand -hex 32)"
SCHEDULER_SECRET="$(openssl rand -hex 32)"

# ---------------------------------------------------------------------------------------------------------------
step "4/8 Database (bảng, cron, Vault)"
HAS_INIT="$("${SB[@]}" db query --remote --yes --read-only "select (to_regclass('public.sync_rows') is not null)::text as has_schema" 2>&1 || true)"
if printf '%s' "$HAS_INIT" | grep -qw true; then
  ok "Schema gốc (0001) đã có"
elif printf '%s' "$HAS_INIT" | grep -qw false; then
  echo "Chưa có schema gốc – chạy 0001_init.sql"
  "${SB[@]}" db query --remote --yes -f supabase/migrations/0001_init.sql >/dev/null
else
  printf '%s\n' "$HAS_INIT"
  fail "Không đọc được database (xem lỗi ở trên)"
fi
cat >"$TMP/vault.sql" <<SQL
do \$\$
begin
  if exists (select 1 from vault.secrets where name = 'lq_project_url') then
    perform vault.update_secret((select id from vault.secrets where name = 'lq_project_url'), '$PROJECT_URL');
  else
    perform vault.create_secret('$PROJECT_URL', 'lq_project_url');
  end if;
  if exists (select 1 from vault.secrets where name = 'lq_scheduler_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'lq_scheduler_secret'), '$SCHEDULER_SECRET');
  else
    perform vault.create_secret('$SCHEDULER_SECRET', 'lq_scheduler_secret');
  end if;
end
\$\$;
SQL
"${SB[@]}" db query --remote --yes -f "$TMP/vault.sql" >/dev/null
"${SB[@]}" db query --remote --yes -f supabase/migrations/0002_cron.sql >/dev/null
"${SB[@]}" db query --remote --yes -f supabase/migrations/0003_delete_my_data.sql >/dev/null
ok "Schema, job cron 5 phút/lần và Vault đã sẵn sàng"

# ---------------------------------------------------------------------------------------------------------------
step "5/8 Secret cho Edge Functions"
{
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$BOT_TOKEN"
  printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$WEBHOOK_SECRET"
  printf 'SCHEDULER_SECRET=%s\n' "$SCHEDULER_SECRET"
  printf 'TELEGRAM_BOT_USERNAME=%s\n' "$BOT_USERNAME"
  printf 'AI_DAILY_LIMIT=100\n'
  [ -n "$GEMINI_KEY" ] && printf 'GEMINI_API_KEY=%s\n' "$GEMINI_KEY"
} >"$TMP/secrets.env"
"${SB[@]}" secrets set --env-file "$TMP/secrets.env" >/dev/null
rm -f "$TMP/secrets.env"
ok "Đã nạp secret (không lưu lại trên máy)"

# ---------------------------------------------------------------------------------------------------------------
step "6/8 Deploy functions"
"${SB[@]}" functions deploy telegram-bot --no-verify-jwt --use-api
"${SB[@]}" functions deploy scheduler --no-verify-jwt --use-api
"${SB[@]}" functions deploy tutor --use-api
ok "Đã deploy telegram-bot, scheduler, tutor"

# ---------------------------------------------------------------------------------------------------------------
step "7/8 Webhook và menu lệnh Telegram"
RES="$(tg setWebhook "{\"url\":\"$PROJECT_URL/functions/v1/telegram-bot\",\"secret_token\":\"$WEBHOOK_SECRET\",\"allowed_updates\":[\"message\",\"callback_query\"],\"drop_pending_updates\":true}")"
[ "$(printf '%s' "$RES" | json_get ok)" = "true" ] || fail "setWebhook lỗi: $(printf '%s' "$RES" | json_get description)"
tg setMyCommands '{"commands":[
  {"command":"today","description":"Kế hoạch hôm nay, thẻ cần ôn, chuỗi ngày"},
  {"command":"review","description":"Ôn thẻ từ đến hạn (FSRS)"},
  {"command":"word","description":"Từ vựng của ngày"},
  {"command":"quiz","description":"Câu hỏi nhanh về điểm yếu của bạn"},
  {"command":"report","description":"Báo cáo thói quen: /report ngay|tuan|thang"},
  {"command":"advice","description":"AI phân tích thói quen học"},
  {"command":"habits","description":"Thống kê thói quen nhanh"},
  {"command":"plan","description":"Kế hoạch học ngày mai do AI đề xuất"},
  {"command":"reset","description":"Xóa lịch sử trò chuyện"},
  {"command":"help","description":"Danh sách lệnh"}]}' >/dev/null
INFO="$(tg getWebhookInfo)"
ERR="$(printf '%s' "$INFO" | json_get result.last_error_message)"
[ -z "$ERR" ] || fail "Webhook báo lỗi: $ERR"
ok "Webhook: $(printf '%s' "$INFO" | json_get result.url)"

# ---------------------------------------------------------------------------------------------------------------
step "8/8 Chạy thử scheduler"
OUT="$(printf 'url = "%s/functions/v1/scheduler"\nheader = "x-scheduler-secret: %s"\n' "$PROJECT_URL" "$SCHEDULER_SECRET" |
  curl -sS -K - -H 'content-type: application/json' --data '{}')"
echo "$OUT"
[ "$(printf '%s' "$OUT" | json_get ok)" = "true" ] || fail "Scheduler chưa chạy được (xem Dashboard → Edge Functions → scheduler → Logs)"
ok "Scheduler chạy được"

cat <<EOF

$(printf '\033[1;32m')XONG! Bot server: @$BOT_USERNAME$(printf '\033[0m')
Việc cuối (trong app B&T English):
  1. Cài đặt → Telegram → chọn "Bot chạy trên server".
  2. Nhập username: $BOT_USERNAME → bấm "Tạo mã liên kết".
  3. Bấm "Mở bot kèm mã này" (hoặc gửi /start <mã> cho @$BOT_USERNAME).
Từ đó nhắc học và báo cáo được gửi kể cả khi máy tắt.
EOF
