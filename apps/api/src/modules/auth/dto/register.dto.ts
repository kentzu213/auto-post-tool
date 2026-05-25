import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'nguyenvan@example.com', description: 'Địa chỉ email người dùng' })
  @IsEmail({}, { message: 'Email không đúng định dạng' })
  @IsNotEmpty({ message: 'Email không được để trống' })
  email: string;

  @ApiProperty({ example: 'superpassword123', description: 'Mật khẩu đăng nhập', minLength: 6 })
  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải dài ít nhất 6 ký tự' })
  password: string;

  @ApiProperty({ example: 'Nguyễn Văn A', description: 'Họ và tên người dùng' })
  @IsString()
  @IsNotEmpty({ message: 'Tên không được để trống' })
  name: string;
}
