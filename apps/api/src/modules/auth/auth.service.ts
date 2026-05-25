import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Đăng ký tài khoản người dùng mới
   * Tự động tạo 1 Workspace mặc định và gán quyền Owner cho người dùng này.
   */
  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email này đã được sử dụng trên hệ thống');
    }

    // Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Chạy transaction để tạo User và Workspace đồng thời
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          name: dto.name,
        },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      });

      // Tạo Workspace cá nhân mặc định cho user
      const workspace = await tx.workspace.create({
        data: {
          name: `${user.name}'s Workspace`,
          ownerId: user.id,
        },
      });

      // Thêm User vào bảng phân quyền Workspace với quyền owner
      await tx.teamMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'owner',
        },
      });

      // Ghi log hoạt động
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'register',
          details: `Đăng ký tài khoản thành công. Đã tự động tạo Workspace mặc định: ${workspace.name}`,
        },
      });

      return {
        user,
        workspace: {
          id: workspace.id,
          name: workspace.name,
        },
      };
    });
  }

  /**
   * Đăng nhập người dùng bằng email/password
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không chính xác');
    }

    // Tìm workspace mặc định của user để gửi kèm trong token payload
    const workspaceMember = await this.prisma.teamMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    const payload = { 
      sub: user.id, 
      email: user.email,
      workspaceId: workspaceMember?.workspaceId || null
    };

    // Ghi log hoạt động
    await this.prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'login',
        details: 'Đăng nhập vào hệ thống thành công',
      },
    });

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      defaultWorkspace: workspaceMember ? {
        id: workspaceMember.workspace.id,
        name: workspaceMember.workspace.name,
        role: workspaceMember.role,
      } : null,
    };
  }

  /**
   * Xác thực và đồng bộ người dùng từ Supabase vào cơ sở dữ liệu Postgres cục bộ
   */
  async syncSupabaseUser(email: string, name: string, supabaseToken: string) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    // 1. Xác thực bảo mật Token qua API của Supabase
    if (supabaseUrl && supabaseAnonKey && supabaseToken) {
      try {
        const axios = require('axios');
        const response = await axios.get(`${supabaseUrl}/auth/v1/user`, {
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseToken}`
          }
        });

        const supabaseUser = response.data;
        if (supabaseUser.email !== email) {
          throw new UnauthorizedException('Token Supabase không trùng khớp với email đăng nhập');
        }
      } catch (err: any) {
        console.error('❌ Supabase verification failed:', err.message);
        throw new UnauthorizedException('Token xác thực Supabase không hợp lệ hoặc đã hết hạn');
      }
    }

    // 2. Tìm hoặc tự động đồng bộ người dùng cục bộ
    let user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      console.log(`🌐 Syncing new Supabase user locally: ${email}`);
      const randomPassword = require('crypto').randomBytes(16).toString('hex');
      const hashedPassword = await bcrypt.hash(randomPassword, 10);

      user = await this.prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            email,
            password: hashedPassword,
            name: name || email.split('@')[0],
          },
        });

        // Tạo Workspace cá nhân mặc định cho user mới đồng bộ
        const workspace = await tx.workspace.create({
          data: {
            name: `${newUser.name}'s Workspace`,
            ownerId: newUser.id,
          },
        });

        // Thêm Owner phân quyền Workspace
        await tx.teamMember.create({
          data: {
            workspaceId: workspace.id,
            userId: newUser.id,
            role: 'owner',
          },
        });

        // Ghi log hoạt động
        await tx.auditLog.create({
          data: {
            userId: newUser.id,
            action: 'supabase_sync_register',
            details: `Đồng bộ tài khoản thành công từ izziapi.com thông qua Supabase. Tạo Workspace mặc định: ${workspace.name}`,
          },
        });

        return newUser;
      });
    } else {
      console.log(`🌐 Supabase user already synced locally: ${email}`);
    }

    // 3. Ký và trả về Local JWT Token để Frontend sử dụng bình thường
    const workspaceMember = await this.prisma.teamMember.findFirst({
      where: { userId: user.id },
      include: { workspace: true },
    });

    const payload = { 
      sub: user.id, 
      email: user.email,
      workspaceId: workspaceMember?.workspaceId || null
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      defaultWorkspace: workspaceMember ? {
        id: workspaceMember.workspace.id,
        name: workspaceMember.workspace.name,
        role: workspaceMember.role,
      } : null,
    };
  }
}

