import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

@Controller('customer/addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get()
  async getAddresses(@Request() req: any) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.getAddresses(customerId);
  }

  @Get('default')
  async getDefaultAddress(@Request() req: any) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.getDefaultAddress(customerId);
  }

  @Post()
  async createAddress(@Request() req: any, @Body() dto: CreateAddressDto) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.createAddress(customerId, dto);
  }

  @Patch(':id')
  async updateAddress(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.updateAddress(customerId, id, dto);
  }

  @Delete(':id')
  async deleteAddress(@Request() req: any, @Param('id') id: string) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.deleteAddress(customerId, id);
  }

  @Patch(':id/default')
  async setDefaultAddress(@Request() req: any, @Param('id') id: string) {
    const customerId = req.user.userId || req.user.sub;
    return this.addressesService.setDefaultAddress(customerId, id);
  }
}
