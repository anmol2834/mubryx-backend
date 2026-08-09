import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { MergeCartDto } from './dto/merge-cart.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

function getUserIdFromUser(user: any): string {
  const userId = user?.userId || user?.sub || user?.id;
  if (!userId) {
    throw new UnauthorizedException('Invalid or missing user context in token');
  }
  return userId;
}

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.cartService.getCart(userId);
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  async addCartItem(
    @CurrentUser() user: any,
    @Body() dto: AddCartItemDto,
  ) {
    const userId = getUserIdFromUser(user);
    return this.cartService.addCartItem(userId, dto);
  }

  @Patch('items/:id')
  async updateCartItem(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    const userId = getUserIdFromUser(user);
    return this.cartService.updateCartItem(userId, id, dto);
  }

  @Delete('items/:id')
  async removeCartItem(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const userId = getUserIdFromUser(user);
    return this.cartService.removeCartItem(userId, id);
  }

  @Delete()
  async clearCart(@CurrentUser() user: any) {
    const userId = getUserIdFromUser(user);
    return this.cartService.clearCart(userId);
  }

  @Post('merge')
  @HttpCode(HttpStatus.OK)
  async mergeCart(
    @CurrentUser() user: any,
    @Body() dto: MergeCartDto,
  ) {
    const userId = getUserIdFromUser(user);
    return this.cartService.mergeGuestCart(userId, dto);
  }
}
