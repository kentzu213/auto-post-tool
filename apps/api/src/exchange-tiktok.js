require('dotenv').config();
const { PrismaClient, Platform, AccountStatus } = require('@prisma/client');
const crypto = require('crypto');
const axios = require('axios');
const readline = require('readline');

const hexKey = process.env.ENCRYPTION_KEY;
if (!hexKey) {
  throw new Error('CRITICAL: ENCRYPTION_KEY environment variable is required.');
}
const key = Buffer.from(hexKey, 'hex');

function decrypt(encryptedText) {
  if (!encryptedText) return '';
  const parts = encryptedText.split(':');
  if (parts.length !== 3) return '';
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const authTag = Buffer.from(parts[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
  console.log("\n=======================================================");
  console.log("   TIKTOK ACCESS TOKEN EXCHANGE & DIRECT CONNECT TOOL");
  console.log("=======================================================\n");

  try {
    // Step 1: Get configured TikTok credentials from DB
    const cred = await prisma.providerCredential.findFirst({
      where: { platform: Platform.tiktok, isActive: true }
    });

    if (!cred) {
      console.error("❌ Lỗi: Bạn chưa cấu hình TikTok Client Key & Client Secret trong Settings!");
      console.log("Vui lòng vào trang Settings -> API Providers cấu hình trước.");
      process.exit(1);
    }

    const clientId = decrypt(cred.clientId);
    const clientSecret = decrypt(cred.clientSecret);

    console.log("🔑 Thông tin cấu hình đã tìm thấy:");
    console.log(`- Client Key: ${clientId}`);
    console.log(`- Redirect URI mặc định trong DB: ${cred.redirectUri}`);
    console.log("\n-------------------------------------------------------\n");

    const userRedirectUri = await question("👉 Nhập Redirect URI bạn đã khai báo trên TikTok Developer Portal\n(Ví dụ: https://izziapi.com/social-auth/callback/tiktok): ");
    const redirectUri = userRedirectUri.trim() || cred.redirectUri;

    console.log(`\n✅ Sử dụng Redirect URI: ${redirectUri}`);
    console.log("\n-------------------------------------------------------\n");

    // Step 2: Print the authorization link (including pre-calculated PKCE challenge)
    const scopes = 'user.info.basic,video.upload,video.publish';
    const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientId}&scope=${scopes}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=manual_connect&code_challenge=ajmf-yjOZwloLzHeWLp-hS7HPx09VXsDVDl4VWV5QUo&code_challenge_method=S256`;

    console.log("👉 BƯỚC 1: Click/Copy link dưới đây dán vào trình duyệt để đăng nhập TikTok:");
    console.log(`\n\x1b[36m${authUrl}\x1b[0m\n`);
    console.log("Sau khi bấm chấp nhận, trình duyệt sẽ redirect đến trang web của bạn.");
    console.log("Mặc dù trang web báo lỗi hoặc không tải được, hãy nhìn lên thanh địa chỉ (Address Bar)!");
    console.log("Copy toàn bộ link trên thanh địa chỉ hoặc phần '?code=xxxx' dán vào bên dưới.");
    console.log("\n-------------------------------------------------------\n");

    // Step 3: Ask for redirect url or code
    const userInput = await question("👉 BƯỚC 2: Nhập URL hoặc Code tại đây: ");
    let code = userInput.trim();

    if (code.includes('code=')) {
      try {
        const urlObj = new URL(code.startsWith('http') ? code : `http://dummy.com/${code}`);
        code = urlObj.searchParams.get('code') || code;
      } catch (e) {
        // If URL parsing fails, search for code= parameter using regex
        const match = code.match(/[?&]code=([^&]+)/);
        if (match) {
          code = match[1];
        }
      }
    }

    if (!code) {
      console.error("❌ Lỗi: Mã code không hợp lệ!");
      process.exit(1);
    }

    console.log(`\n🔄 Đang trao đổi mã code [${code.slice(0, 10)}...] lấy Access Token từ TikTok...`);

    // Step 4: Exchange code for token (including static code verifier for PKCE validation)
    const tokenResponse = await axios.post(
      `https://open.tiktokapis.com/v2/oauth/token/`,
      new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: 'this_is_a_long_static_code_verifier_value_for_tiktok_pkce_autopost_local_app_12345',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );

    const { access_token, refresh_token, expires_in, open_id } = tokenResponse.data;
    
    if (!access_token) {
      console.error("❌ Lỗi: TikTok không trả về access_token. Chi tiết phản hồi:", tokenResponse.data);
      process.exit(1);
    }

    console.log("✅ Lấy Access Token thành công!");
    console.log(`- Access Token: ${access_token.slice(0, 20)}...`);
    console.log(`- Refresh Token: ${refresh_token ? refresh_token.slice(0, 20) + '...' : 'Không có'}`);

    console.log("\n🔄 Đang tải thông tin profile từ TikTok API...");

    // Step 5: Get user info
    const userResponse = await axios.get(`https://open.tiktokapis.com/v2/user/info/`, {
      headers: { Authorization: `Bearer ${access_token}` },
      params: { fields: 'open_id,union_id,avatar_url,display_name,username' },
    });

    const user = userResponse.data.data?.user;
    if (!user) {
      throw new Error('Không thể lấy thông tin profile từ TikTok API.');
    }

    console.log("👤 Đã tải thông tin profile thành công:");
    console.log(`  - Tên hiển thị: ${user.display_name}`);
    console.log(`  - Username: @${user.username}`);
    console.log(`  - Open ID: ${user.open_id}`);

    console.log("\n🔄 Đang tự động lưu tài khoản vào Database...");

    // Step 6: Save to DB
    const savedAccount = await prisma.socialAccount.upsert({
      where: {
        platform_platformAccountId: {
          platform: Platform.tiktok,
          platformAccountId: user.open_id,
        },
      },
      update: {
        displayName: user.display_name,
        username: `@${user.username}`,
        avatarUrl: user.avatar_url || '',
        accessToken: encrypt(access_token),
        refreshToken: refresh_token ? encrypt(refresh_token) : undefined,
        tokenExpiresAt: new Date(Date.now() + (expires_in || 86400) * 1000),
        status: AccountStatus.active,
        workspaceId: cred.workspaceId,
      },
      create: {
        workspaceId: cred.workspaceId,
        platform: Platform.tiktok,
        platformAccountId: user.open_id,
        displayName: user.display_name,
        username: `@${user.username}`,
        avatarUrl: user.avatar_url || '',
        accessToken: encrypt(access_token),
        refreshToken: refresh_token ? encrypt(refresh_token) : undefined,
        tokenExpiresAt: new Date(Date.now() + (expires_in || 86400) * 1000),
        status: AccountStatus.active,
      },
    });

    console.log("\n🎉 KẾT NỐI THÀNH CÔNG!");
    console.log(`Tài khoản TikTok "${savedAccount.displayName}" (@${savedAccount.username}) đã được liên kết.`);
    console.log("Hãy quay lại giao diện Web và refresh trang để thấy tài khoản xuất hiện!");

  } catch (err) {
    console.error("\n❌ Gặp lỗi khi xử lý:");
    if (err.response?.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  } finally {
    rl.close();
    await prisma.$disconnect();
  }
}

main();
