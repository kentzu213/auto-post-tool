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
}
