import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class BatchDeleteUsersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  userIds: string[];

  /**
   * false/omitted = deactivate (soft delete, default).
   * true = permanently remove the users AND their attendance history.
   */
  @IsOptional()
  @IsBoolean()
  permanent?: boolean;
}
