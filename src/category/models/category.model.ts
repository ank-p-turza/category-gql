import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CategoryType {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field()
  path: string;

  @Field(() => Int)
  depth: number;

  @Field(() => ID, { nullable: true })
  parentId: string | null;

  @Field()
  isActive: boolean;

  @Field(() => [CategoryType], { nullable: true })
  children?: CategoryType[];

  @Field(() => CategoryType, { nullable: true })
  parent?: CategoryType | null;
}

@ObjectType()
export class CategorySearchResultType {
  @Field(() => CategoryType)
  category: CategoryType;

  @Field(() => CategoryType, { nullable: true })
  parent: CategoryType | null;
}