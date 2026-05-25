import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCampaignDto {
  @ApiProperty({ description: 'ID Workspace', example: 'workspace_abc123' })
  @IsString()
  @IsNotEmpty()
  workspaceId: string;

  @ApiProperty({ description: 'Tên campaign', example: 'Launch iPhone 18 Pro Max' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: 'Mô tả campaign', example: 'Chiến dịch ra mắt sản phẩm mới' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'KPI mục tiêu (JSON hoặc text)', example: '{"reach": 100000, "engagement": 5000}' })
  @IsOptional()
  @IsString()
  kpiTarget?: string;
}
