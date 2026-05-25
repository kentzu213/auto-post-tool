import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'demo@autopost.local';
  const password = 'demo123456';
  const name = 'Izzi Demo User';

  console.log(`🌱 Seeding demo user: ${email}...`);

  // Mã hóa mật khẩu giống như trong AuthService
  const hashedPassword = await bcrypt.hash(password, 10);

  // Thực hiện transaction để tạo User và Workspace đồng bộ
  await prisma.$transaction(async (tx) => {
    // 1. Kiểm tra hoặc tạo User
    let user = await tx.user.findUnique({
      where: { email }
    });

    if (user) {
      console.log(`ℹ️ User ${email} already exists. Updating password...`);
      user = await tx.user.update({
        where: { email },
        data: {
          password: hashedPassword,
          name
        }
      });
    } else {
      user = await tx.user.create({
        data: {
          email,
          password: hashedPassword,
          name
        }
      });
      console.log(`✅ Created User: ${email}`);
    }

    // 2. Kiểm tra hoặc tạo Workspace
    let workspace = await tx.workspace.findFirst({
      where: { ownerId: user.id }
    });

    if (!workspace) {
      workspace = await tx.workspace.create({
        data: {
          name: `${user.name}'s Workspace`,
          ownerId: user.id
        }
      });
      console.log(`✅ Created Default Workspace: ${workspace.name}`);
    }

    // 3. Phân quyền owner trong teamMember
    const teamMember = await tx.teamMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: user.id
        }
      }
    });

    if (!teamMember) {
      await tx.teamMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'owner'
        }
      });
      console.log(`✅ Assigned Owner role in team_members`);
    }
  });

  console.log('🎉 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
