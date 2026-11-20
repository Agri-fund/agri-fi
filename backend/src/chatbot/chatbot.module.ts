import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatbotController } from './chatbot.controller';
import { ChatbotService } from './chatbot.service';
import { ChatbotContextService } from './chatbot-context.service';
import { EmotionDetectorService } from './emotion-detector.service';
import { EmpathyEngineService } from './empathy-engine.service';
import { ChatbotConversation } from './chatbot-conversation.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { User } from '../auth/entities/user.entity';
import { Investment } from '../investments/entities/investment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatbotConversation,
      TradeDeal,
      User,
      Investment,
    ]),
  ],
  controllers: [ChatbotController],
  providers: [
    ChatbotService,
    ChatbotContextService,
    EmotionDetectorService,
    EmpathyEngineService,
  ],
  exports: [ChatbotService],
})
export class ChatbotModule {}
