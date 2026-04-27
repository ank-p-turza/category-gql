import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RedisCacheService } from '../cache/redis-cache.service';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryInput } from './dto/create-category.input';
import { UpdateCategoryInput } from './dto/update-category.input';

@Injectable()
export class CategoryService {
  private readonly cachePrefix = 'categories:';

  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    private readonly cacheService: RedisCacheService,
  ) {}

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ID: ${id}`);
    }
    return new Types.ObjectId(id);
  }

  private async withCache<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = `${this.cachePrefix}${key}`;
    const cached = await this.cacheService.get<T>(cacheKey);

    if (cached !== null) {
      return cached;
    }

    const result = await loader();
    if (result !== null && result !== undefined) {
      await this.cacheService.set(cacheKey, result);
    }

    return result;
  }

  private async invalidateCategoryCache() {
    await this.cacheService.deleteByPrefix(this.cachePrefix);
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  private async ensureUniqueName(name: string, excludeId?: string) {
    const filter: {
      normalizedName: string;
      _id?: { $ne: Types.ObjectId };
    } = {
      normalizedName: this.normalizeName(name),
    };

    if (excludeId) {
      filter._id = { $ne: this.toObjectId(excludeId) };
    }

    const existing = await this.categoryModel.findOne(filter).select('_id');
    if (existing) {
      throw new BadRequestException(`Category "${name}" already exists`);
    }
  }

  private async getCategoryDocumentOrThrow(
    id: string,
    errorMessage = 'Category not found',
  ): Promise<CategoryDocument> {
    const category = await this.categoryModel.findById(this.toObjectId(id));
    if (!category) {
      throw new NotFoundException(errorMessage);
    }

    return category;
  }

  private descendantsRegex(path: string): RegExp {
    return new RegExp(`^${this.escapeRegex(path)}>`);
  }

  private subtreeRegex(path: string): RegExp {
    return new RegExp(`^${this.escapeRegex(path)}(?:>|$)`);
  }

  async create(input: CreateCategoryInput): Promise<CategoryDocument> {
    const name = input.name.trim();
    if (!name) {
      throw new BadRequestException('Category name is required');
    }

    await this.ensureUniqueName(name);

    let parent: CategoryDocument | null = null;
    if (input.parentId) {
      parent = await this.getCategoryDocumentOrThrow(input.parentId, 'Parent category not found');
    }

    const created = await this.categoryModel.create({
      name,
      normalizedName: this.normalizeName(name),
      slug: this.toSlug(name),
      path: parent ? `${parent.path}>${name}` : name,
      depth: parent ? parent.depth + 1 : 0,
      parentId: parent ? parent._id : null,
      isActive: parent ? parent.isActive : true,
    });

    await this.invalidateCategoryCache();
    return created;
  }

  async getChildren(parentId: string | null): Promise<CategoryDocument[]> {
    const filter = parentId
      ? { parentId: this.toObjectId(parentId) }
      : { parentId: null };

    return this.withCache(`children:${parentId ?? 'root'}`, async () => (
      this.categoryModel.find(filter).sort({ name: 1 })
    ));
  }

  async getTree(): Promise<CategoryDocument[]> {
    return this.withCache('tree', async () => (
      this.categoryModel.find({ parentId: null }).sort({ name: 1 })
    ));
  }

  async getDescendants(categoryId: string): Promise<CategoryDocument[]> {
    const category = await this.findById(categoryId);

    return this.withCache(`descendants:${categoryId}`, async () => (
      this.categoryModel
        .find({
          path: { $regex: this.descendantsRegex(category.path) },
        })
        .sort({ path: 1 })
    ));
  }

  async getAncestors(categoryId: string): Promise<CategoryDocument[]> {
    const category = await this.findById(categoryId);
    if (!category.path) return [];

    const parts = category.path.split('>').slice(0, -1);
    const ancestorPaths = parts.map((_, i) => parts.slice(0, i + 1).join('>'));
    if (ancestorPaths.length === 0) return [];

    return this.withCache(`ancestors:${categoryId}`, async () => (
      this.categoryModel
        .find({ path: { $in: ancestorPaths } })
        .sort({ depth: 1 })
    ));
  }

  async update(
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryDocument> {
    const category = await this.getCategoryDocumentOrThrow(categoryId);

    const nextName = input.name?.trim() ?? category.name;
    if (!nextName) {
      throw new BadRequestException('Category name is required');
    }
    if (nextName !== category.name) {
      await this.ensureUniqueName(nextName, categoryId);
    }

    const hasParentInInput = input.parentId !== undefined;
    let nextParentId = category.parentId ? String(category.parentId) : null;
    if (hasParentInInput) {
      nextParentId = input.parentId ?? null;
    }

    let nextParent: CategoryDocument | null = null;
    if (nextParentId) {
      if (nextParentId === categoryId) {
        throw new BadRequestException('Cannot set a category as its own parent');
      }

      nextParent = await this.getCategoryDocumentOrThrow(nextParentId, 'Parent category not found');
      if (
        nextParent.path === category.path
        || nextParent.path.startsWith(`${category.path}>`)
      ) {
        throw new BadRequestException('Cannot move category into its own descendant');
      }
    }

    if (input.isActive === true && nextParent && !nextParent.isActive) {
      throw new BadRequestException('Cannot activate a category under an inactive parent');
    }

    const oldPath = category.path;
    const newPath = nextParent ? `${nextParent.path}>${nextName}` : nextName;
    const newDepth = nextParent ? nextParent.depth + 1 : 0;
    const depthDiff = newDepth - category.depth;

    await this.categoryModel.updateOne(
      { _id: category._id },
      {
        $set: {
          name: nextName,
          normalizedName: this.normalizeName(nextName),
          slug: this.toSlug(nextName),
          path: newPath,
          depth: newDepth,
          parentId: nextParent ? nextParent._id : null,
        },
      },
    );

    if (oldPath !== newPath) {
      const descendants = await this.categoryModel.find({
        path: { $regex: this.descendantsRegex(oldPath) },
      });

      if (descendants.length > 0) {
        const oldPathRegex = new RegExp(`^${this.escapeRegex(oldPath)}`);
        await this.categoryModel.bulkWrite(
          descendants.map((descendant) => ({
            updateOne: {
              filter: { _id: descendant._id },
              update: {
                $set: {
                  path: descendant.path.replace(oldPathRegex, newPath),
                  depth: descendant.depth + depthDiff,
                },
              },
            },
          })),
        );
      }
    }

    if (input.isActive === false || (nextParent && !nextParent.isActive)) {
      await this.categoryModel.updateMany(
        { path: { $regex: this.subtreeRegex(newPath) } },
        { $set: { isActive: false } },
      );
    } else if (input.isActive === true) {
      await this.categoryModel.updateOne(
        { _id: category._id },
        { $set: { isActive: true } },
      );
    }

    await this.invalidateCategoryCache();
    return this.getCategoryDocumentOrThrow(categoryId);
  }

  async moveCategory(
    categoryId: string,
    newParentId: string | null,
  ): Promise<CategoryDocument> {
    return this.update(categoryId, { parentId: newParentId });
  }

  async deactivate(categoryId: string): Promise<CategoryDocument> {
    const category = await this.getCategoryDocumentOrThrow(categoryId);

    await this.categoryModel.updateMany(
      { path: { $regex: this.subtreeRegex(category.path) } },
      { $set: { isActive: false } },
    );

    await this.invalidateCategoryCache();
    return this.getCategoryDocumentOrThrow(categoryId);
  }

  async remove(categoryId: string): Promise<boolean> {
    const category = await this.getCategoryDocumentOrThrow(categoryId);

    await this.categoryModel.deleteMany({
      path: { $regex: this.subtreeRegex(category.path) },
    });

    await this.invalidateCategoryCache();
    return true;
  }

  async searchByName(
    searchTerm: string,
  ): Promise<Array<{ category: CategoryDocument; parent: CategoryDocument | null }>> {
    const term = searchTerm.trim();
    if (!term) {
      return [];
    }

    return this.withCache(`search:${this.normalizeName(term)}`, async () => {
      const categories = await this.categoryModel
        .find({
          name: { $regex: this.escapeRegex(term), $options: 'i' },
        })
        .sort({ path: 1 });

      const parentIds = Array.from(
        new Set(
          categories
            .filter((category) => !!category.parentId)
            .map((category) => String(category.parentId)),
        ),
      );

      const parents = parentIds.length > 0
        ? await this.categoryModel.find({
          _id: { $in: parentIds.map((id) => this.toObjectId(id)) },
        })
        : [];

      const parentMap = new Map(
        parents.map((parent) => [String(parent._id), parent]),
      );

      return categories.map((category) => ({
        category,
        parent: category.parentId
          ? (parentMap.get(String(category.parentId)) ?? null)
          : null,
      }));
    });
  }

  async findById(id: string): Promise<CategoryDocument> {
    const objectId = this.toObjectId(id);
    const category = await this.withCache(`by-id:${id}`, async () => (
      this.categoryModel.findById(objectId)
    ));

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async findAll(): Promise<CategoryDocument[]> {
    return this.withCache('all', async () => (
      this.categoryModel.find().sort({ path: 1 })
    ));
  }

  private toSlug(name: string): string {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return slug || `category-${Date.now()}`;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}