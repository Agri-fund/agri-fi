# Database Schema ER Diagram

> Auto-generated from TypeORM entities by `npm run doc:diagram`. Do not edit manually.

```mermaid
erDiagram
    %% Domain: USERS
    AnnualInvestmentTotal {
        string id PK
    }
    Achievement {
        string id PK
    }
    AmlAlert {
        string id PK
    }
    AmlCase {
        string id PK
    }
    AmlDispositionFeedback {
        string id PK
    }
    AmlMonitoringRule {
        string id PK
    }
    AmlMonitoringRun {
        string id PK
    }
    AmlRegulatorySubmission {
        string id PK
    }
    AmlSarReport {
        string id PK
    }
    AmlScreeningResult {
        string id PK
    }
    SanctionsListEntry {
        string id PK
    }
    AMMLiquidityPosition {
        string id PK
    }
    AMMMiningReward {
        string id PK
    }
    AMMPool {
        string id PK
    }
    AMMSwap {
        string id PK
    }
    InvestmentArchive {
        string id PK
    }
    ShipmentMilestoneArchive {
        string id PK
    }
    TradeDealArchive {
        string id PK
    }
    SystemAuditLog {
        string id PK
    }
    ApiKey {
        string id PK
    }
    BiometricCredential {
        string id PK
    }
    KycSubmission {
        string id PK
    }
    ReferralCode {
        string id PK
    }
    Referral {
        string id PK
    }
    User {
        string id PK
    }
    ChatAttachment {
        string id PK
    }
    ChatConversation {
        string id PK
    }
    ChatMessage {
        string id PK
    }
    ChatParticipant {
        string id PK
    }
    ChatbotConversation {
        string id PK
    }
    CollaborationPermission {
        string id PK
    }
    CollaborationSession {
        string id PK
    }
    ComplianceReport {
        string id PK
    }
    RegulatoryRuleExecution {
        string id PK
    }
    RegulatoryRule {
        string id PK
    }
    AdminAction {
        string id PK
    }
    AuditLog {
        string id PK
    }
    ComplianceAlert {
        string id PK
    }
    FeeConfiguration {
        string id PK
    }
    LoginLog {
        string id PK
    }
    SecurityIpBlock {
        string id PK
    }
    TransactionLog {
        string id PK
    }
    DocumentVersion {
        string id PK
    }
    SignatureRequest {
        string id PK
    }
    EdgeNode {
        string id PK
    }
    EdgeSyncRecord {
        string id PK
    }
    InvestorEmailSequence {
        string id PK
    }
    MilestoneReleaseRecord {
        string id PK
    }
    PaymentDistribution {
        string id PK
    }
    AutoInvestPlan {
        string id PK
    }
    InvestmentEvent {
        string id PK
    }
    Investment {
        string id PK
    }
    LiquiditySnapshot {
        string id PK
    }
    SecondaryOrder {
        string id PK
    }
    SecondaryTrade {
        string id PK
    }
    KycJurisdictionRule {
        string id PK
    }
    NotificationPreference {
        string id PK
    }
    NotificationEntity {
        string id PK
    }
    PushSubscriptionEntity {
        string id PK
    }
    OracleFeed {
        string id PK
    }
    OracleObservation {
        string id PK
    }
    OutboxEntity {
        string id PK
    }
    CalendarConnection {
        string id PK
    }
    CalendarEvent {
        string id PK
    }
    FeatureFlagAudit {
        string id PK
    }
    FeatureFlag {
        string id PK
    }
    Shard {
        string id PK
    }
    ApiUsageEvent {
        string id PK
    }
    PartnerApiUsage {
        string id PK
    }
    NettingCycle {
        string id PK
    }
    NettingObligation {
        string id PK
    }
    MilestoneComment {
        string id PK
    }
    MilestoneVerification {
        string id PK
    }
    ShipmentMilestone {
        string id PK
    }
    ShipmentSensorReading {
        string id PK
    }
    AccountMergeRecovery {
        string id PK
    }
    Sep24Transaction {
        string id PK
    }
    StellarHistory {
        string id PK
    }
    UnrecognisedPayment {
        string id PK
    }
    DealCoFarmer {
        string id PK
    }
    DealHealthAlert {
        string id PK
    }
    Document {
        string id PK
    }
    TradeDeal {
        string id PK
    }
    SorobanContractDeployment {
        string id PK
    }
    FarmerCreditScoreHistory {
        string id PK
    }
    WebhookSubscription {
        string id PK
    }
    %% Domain: DEALS
    %% Domain: INVESTMENTS
    %% Domain: PAYMENTS
    %% Domain: COMPLIANCE

    %% Relationships
    AnnualInvestmentTotal }o--|| User : "ManyToOne"
    Achievement }o--|| User : "ManyToOne"
    AmlAlert }o--|| AmlMonitoringRule : "ManyToOne"
    AmlAlert }o--|| AmlCase : "ManyToOne"
    AmlSarReport }o--|| AmlCase : "ManyToOne"
    AMMLiquidityPosition }o--|| AMMPool : "ManyToOne"
    AMMLiquidityPosition }o--|| User : "ManyToOne"
    AMMMiningReward }o--|| AMMPool : "ManyToOne"
    AMMMiningReward }o--|| User : "ManyToOne"
    AMMPool }o--|| TradeDeal : "ManyToOne"
    AMMPool }o--|| User : "ManyToOne"
    AMMPool ||--o{ AMMLiquidityPosition : "OneToMany"
    AMMPool ||--o{ AMMSwap : "OneToMany"
    AMMSwap }o--|| AMMPool : "ManyToOne"
    AMMSwap }o--|| User : "ManyToOne"
    BiometricCredential }o--|| User : "ManyToOne"
    KycSubmission }o--|| User : "ManyToOne"
    ReferralCode }o--|| User : "ManyToOne"
    Referral }o--|| User : "ManyToOne"
    ChatAttachment }o--|| ChatMessage : "ManyToOne"
    ChatConversation ||--o{ ChatParticipant : "OneToMany"
    ChatConversation ||--o{ ChatMessage : "OneToMany"
    ChatMessage }o--|| ChatConversation : "ManyToOne"
    ChatMessage }o--|| User : "ManyToOne"
    ChatMessage }o--|| ChatMessage : "ManyToOne"
    ChatMessage ||--o{ ChatAttachment : "OneToMany"
    ChatParticipant }o--|| ChatConversation : "ManyToOne"
    ChatParticipant }o--|| User : "ManyToOne"
    TransactionLog }o--|| User : "ManyToOne"
    TransactionLog }o--|| TradeDeal : "ManyToOne"
    SignatureRequest }o--|| Document : "ManyToOne"
    SignatureRequest }o--|| User : "ManyToOne"
    InvestorEmailSequence }o--|| User : "ManyToOne"
    MilestoneReleaseRecord }o--|| TradeDeal : "ManyToOne"
    PaymentDistribution }o--|| TradeDeal : "ManyToOne"
    AutoInvestPlan }o--|| User : "ManyToOne"
    Investment }o--|| TradeDeal : "ManyToOne"
    Investment }o--|| User : "ManyToOne"
    SecondaryOrder }o--|| User : "ManyToOne"
    SecondaryTrade }o--|| User : "ManyToOne"
    NotificationPreference }o--|| User : "ManyToOne"
    NotificationEntity }o--|| User : "ManyToOne"
    PushSubscriptionEntity }o--|| User : "ManyToOne"
    MilestoneComment }o--|| ShipmentMilestone : "ManyToOne"
    DealCoFarmer }o--|| TradeDeal : "ManyToOne"
    DealCoFarmer }o--|| User : "ManyToOne"
    DealHealthAlert }o--|| TradeDeal : "ManyToOne"
    Document }o--|| TradeDeal : "ManyToOne"
    Document }o--|| User : "ManyToOne"
    TradeDeal }o--|| User : "ManyToOne"
    TradeDeal ||--o{ Document : "OneToMany"
    TradeDeal ||--o{ Investment : "OneToMany"
```

