import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản người dùng mới' })
  @ApiResponse({ status: 201, description: 'Tạo tài khoản và workspace mặc định thành công' })
  @ApiResponse({ status: 409, description: 'Email đã tồn tại trên hệ thống' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập hệ thống' })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công và trả về JWT Access Token' })
  @ApiResponse({ status: 401, description: 'Email hoặc mật khẩu không chính xác' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('supabase-sync')
  @ApiOperation({ summary: 'Đồng bộ tài khoản Supabase và phát hành Local JWT' })
  @ApiResponse({ status: 200, description: 'Đồng bộ và đăng nhập thành công' })
  async supabaseSync(
    @Body() dto: { email: string; name: string; supabaseToken: string },
  ) {
    return this.authService.syncSupabaseUser(dto.email, dto.name, dto.supabaseToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy thông tin tài khoản hiện tại' })
  @ApiResponse({ status: 200, description: 'Lấy profile thành công' })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập / Token không hợp lệ' })
  async getProfile(@Req() req: any) {
    return req.user;
  }
}
