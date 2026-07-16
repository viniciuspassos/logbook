import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Entry } from './entry.entity'
import { EntriesRepository } from './entries.repository'
import { EntriesService } from './entries.service'
import { EntriesController } from './entries.controller'

@Module({
  imports: [TypeOrmModule.forFeature([Entry])],
  controllers: [EntriesController],
  providers: [EntriesRepository, EntriesService],
  exports: [EntriesRepository, EntriesService],
})
export class EntriesModule {}
