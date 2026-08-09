import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Public()
  @Get('catalog')
  async getCatalog() {
    return this.catalogService.getCatalog();
  }

  @Public()
  @Get('categories')
  async getCategories() {
    return this.catalogService.getCategories();
  }

  @Public()
  @Get('categories/:idOrSlug')
  async getCategoryByIdOrSlug(@Param('idOrSlug') idOrSlug: string) {
    return this.catalogService.getCategoryByIdOrSlug(idOrSlug);
  }

  @Public()
  @Get('services')
  async getServices(
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('isPopular') isPopular?: string,
  ) {
    return this.catalogService.getServices({
      categoryId,
      search,
      isPopular: isPopular === 'true',
    });
  }

  @Public()
  @Get('services/:id')
  async getServiceById(@Param('id') id: string) {
    return this.catalogService.getServiceById(id);
  }
}
