import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ShipmentMilestone, TradeDeal]),
    QueueModule,
  ],
  providers: [ShipmentsService],
  controllers: [ShipmentsController],
})
export class ShipmentsModule {}
