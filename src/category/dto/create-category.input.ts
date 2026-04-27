import { Field, ID, InputType } from '@nestjs/graphql';
import { IsMongoId, IsNotEmpty, IsOptional, IsString } from 'class-validator';

@InputType()
export class CreateCategoryInput {
  @Field()
  @IsString()
  @IsNotEmpty()
  name: string;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsMongoId()
  parentId?: string;
}