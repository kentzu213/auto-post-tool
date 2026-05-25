import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

/**
 * DTO cập nhật bài viết — kế thừa từ CreatePostDto, tất cả fields đều optional.
 * Loại bỏ workspaceId vì không cho phép chuyển post sang workspace khác.
 */
export class UpdatePostDto extends PartialType(
  OmitType(CreatePostDto, ['workspaceId'] as const),
) {}
