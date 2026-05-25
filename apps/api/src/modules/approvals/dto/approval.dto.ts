import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateApprovalDto {
  @ApiProperty({ description: 'Post ID cần duyệt' })
  @IsString()
  @IsNotEmpty()
  postId: string;

  @ApiProperty({ description: 'User ID người yêu cầu duyệt' })
  @IsString()
  @IsNotEmpty()
  requestedBy: string;

  @ApiPropertyOptional({ description: 'Ghi chú cho người duyệt' })
  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReviewApprovalDto {
  @ApiProperty({ description: 'User ID người duyệt' })
  @IsString()
  @IsNotEmpty()
  approvedBy: string;

  @ApiProperty({ description: 'Quyết định: approved hoặc rejected', enum: ['approved', 'rejected'] })
  @IsString()
  @IsNotEmpty()
  decision: 'approved' | 'rejected';

  @ApiPropertyOptional({ description: 'Lý do / ghi chú' })
  @IsOptional()
  @IsString()
  comment?: string;
}
