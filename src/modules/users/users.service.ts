import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ 
      where: { id },
      include: { customerProfile: true },
    });
    
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      fullName: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isPhoneVerified: true,
      createdAt: user.createdAt,
    };
  }

  async updateProfile(userId: string, data: { fullName?: string; email?: string; avatar?: string }) {
    // Use a transaction if we need to update related tables, but since name/email are on User model:
    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: data.fullName !== undefined ? data.fullName : undefined,
        email: data.email !== undefined ? data.email : undefined,
      },
      include: { customerProfile: true },
    });

    return {
      id: updatedUser.id,
      fullName: updatedUser.name,
      phone: updatedUser.phone,
      email: updatedUser.email,
      role: updatedUser.role,
      isPhoneVerified: true,
    };
  }
}
