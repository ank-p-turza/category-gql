import {
  Resolver, Query, Mutation, Args, ID,
  ResolveField, Parent,
} from '@nestjs/graphql';
import { CategorySearchResultType, CategoryType } from './models/category.model';
import { CategoryDocument } from './schemas/category.schema';
import { CategoryService } from './category.service';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';

@Resolver(() => CategoryType)
export class CategoryResolver {
  constructor(private readonly categoryService: CategoryService) {}

  @Mutation(() => CategoryType)
  async createCategory(@Args('input') input: CreateCategoryInput) {
    return this.categoryService.create(input);
  }

  @Query(() => [CategoryType])
  async categories() {
    return this.categoryService.findAll();
  }

  @Query(() => [CategoryType])
  async categoryTree() {
    return this.categoryService.getTree();
  }

  @Query(() => CategoryType)
  async category(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.findById(id);
  }

  @Query(() => [CategorySearchResultType])
  async searchCategories(@Args('name') name: string) {
    return this.categoryService.searchByName(name);
  }

  @Query(() => [CategoryType])
  async categoryDescendants(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.getDescendants(id);
  }

  @Query(() => [CategoryType])
  async categoryBreadcrumb(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.getAncestors(id);
  }

  @Mutation(() => CategoryType)
  async moveCategory(
    @Args('categoryId', { type: () => ID }) categoryId: string,
    @Args('newParentId', { type: () => ID, nullable: true }) newParentId?: string,
  ) {
    return this.categoryService.moveCategory(categoryId, newParentId ?? null);
  }

  @Mutation(() => CategoryType)
  async updateCategory(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateCategoryInput,
  ) {
    return this.categoryService.update(id, input);
  }

  @Mutation(() => CategoryType)
  async deactivateCategory(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.deactivate(id);
  }

  @Mutation(() => Boolean)
  async deleteCategory(@Args('id', { type: () => ID }) id: string) {
    return this.categoryService.remove(id);
  }

  @ResolveField(() => [CategoryType])
  async children(@Parent() category: CategoryDocument) {
    return this.categoryService.getChildren(category.id);
  }

  @ResolveField(() => CategoryType, { nullable: true })
  async parent(@Parent() category: CategoryDocument) {
    if (!category.parentId) {
      return null;
    }

    return this.categoryService.findById(String(category.parentId));
  }
}