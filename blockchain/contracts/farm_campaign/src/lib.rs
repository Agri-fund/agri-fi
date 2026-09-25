//! FarmCampaign Soroban Smart Contract
//!
//! Each farming project deploys one instance of this contract.
//! Manages investment acceptance, escrow locking, milestone-based releases,
//! automated revenue distribution, emergency pause, and refunds.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Map, String, Symbol, Vec, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized       = 1,
    AlreadyInitialized   = 2,
    Unauthorized         = 3,
    FundingClosed        = 4,
    TargetExceeded       = 5,
    InsufficientFunds    = 6,
    InvalidAmount        = 7,
    Paused               = 8,
    NotFunded            = 9,
    MilestoneNotFound    = 10,
    MilestoneAlreadyDone = 11,
    RefundNotAllowed     = 12,
    DeadlinePassed       = 13,
    AlreadyDistributed   = 14,
    DisputeActive        = 15,
    NoDispute            = 16,
    InvalidBps           = 17,
    ReleaseCapExceeded   = 18,
}

#[contracttype]
pub enum DataKey {
    Config,
    State,
    Investments,
    MilestoneReleased(u32),
    Distributed,
    Arbitrator,
    Dispute(u32),
    RefundableInvestments,
    Refunded,
    CloseReason,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub farmer: Address,
    pub arbitrator: Address,
    pub usdc_token: Address,
    pub funding_target: i128,
    pub deadline: u64,
    pub platform_fee_bps: u32,
    pub milestone_count: u32,
    pub partial_release_cap_bps: u32,
    pub project_name: String,
    pub commodity: String,
    pub max_funding: i128,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum CampaignStatus {
    Open,
    Funded,
    Active,
    Delivered,
    Completed,
    Failed,
    Paused,
}

#[contracttype]
#[derive(Clone)]
pub struct State {
    pub status: CampaignStatus,
    pub total_raised: i128,
    pub milestones_released: u32,
    pub partial_release_total_bps: u32,
    pub raise_ended: bool,
}

#[contract]
pub struct FarmCampaignContract;

#[contractimpl]
impl FarmCampaignContract {

    pub fn initialize(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        deadline: u64,
        platform_fee_bps: u32,
        milestone_count: u32,
        partial_release_cap_bps: u32,
        project_name: String,
        commodity: String,
    ) -> Result<(), Error> {
        Self::initialize_internal(
            env,
            admin,
            farmer,
            arbitrator,
            usdc_token,
            funding_target,
            funding_target,
            deadline,
            platform_fee_bps,
            milestone_count,
            partial_release_cap_bps,
            project_name,
            commodity,
        )
    }

    pub fn initialize_with_max_funding(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        max_funding: i128,
        deadline: u64,
        platform_fee_bps: u32,
        milestone_count: u32,
        partial_release_cap_bps: u32,
        project_name: String,
        commodity: String,
    ) -> Result<(), Error> {
        Self::initialize_internal(
            env,
            admin,
            farmer,
            arbitrator,
            usdc_token,
            funding_target,
            max_funding,
            deadline,
            platform_fee_bps,
            milestone_count,
            partial_release_cap_bps,
            project_name,
            commodity,
        )
    }

    fn initialize_internal(
        env: Env,
        admin: Address,
        farmer: Address,
        arbitrator: Address,
        usdc_token: Address,
        funding_target: i128,
        max_funding: i128,
        deadline: u64,
        platform_fee_bps: u32,
        milestone_count: u32,
        partial_release_cap_bps: u32,
        project_name: String,
        commodity: String,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if funding_target <= 0
            || max_funding <= 0
            || max_funding < funding_target
        {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::DeadlinePassed);
        }
        if platform_fee_bps > 10_000 {
            return Err(Error::InvalidBps);
        }
        if partial_release_cap_bps == 0 || partial_release_cap_bps > 10_000 {
            return Err(Error::InvalidBps);
        }
        let config = Config {
            admin,
            farmer,
            arbitrator,
            usdc_token,
            funding_target,
            deadline,
            platform_fee_bps,
            milestone_count,
            partial_release_cap_bps,
            project_name,
            commodity,
            max_funding,
        };
        let state = State {
            status: CampaignStatus::Open,
            total_raised: 0,
            milestones_released: 0,
            partial_release_total_bps: 0,
            raise_ended: false,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::Investments, &Map::<Address, i128>::new(&env));
        env.storage().instance().set(
            &DataKey::RefundableInvestments,
            &Map::<Address, i128>::new(&env),
        );
        env.storage().instance().set(&DataKey::Refunded, &Map::<Address, bool>::new(&env));
        env.storage().instance().set(&DataKey::Arbitrator, &arbitrator);
        env.events().publish((Symbol::new(&env, "initialized"),), ());
        Ok(())
    }

    pub fn set_max_funding(env: Env, admin: Address, max_funding: i128) -> Result<(), Error> {
        admin.require_auth();
        let mut config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        if max_funding <= 0 || max_funding < config.funding_target {
            return Err(Error::InvalidAmount);
        }
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended || state.status != CampaignStatus::Open {
            return Err(Error::FundingClosed);
        }
        if env.ledger().timestamp() > config.deadline {
            return Err(Error::DeadlinePassed);
        }
        if state.total_raised > max_funding { return Err(Error::TargetExceeded); }

        config.max_funding = max_funding;
        env.storage().instance().set(&DataKey::Config, &config);
        env.events().publish((Symbol::new(&env, "max_funding"),), max_funding);
        Ok(())
    }

    pub fn invest(env: Env, investor: Address, amount: i128) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.raise_ended { return Err(Error::FundingClosed); }
        if state.status == CampaignStatus::Paused { return Err(Error::Paused); }
        if state.status != CampaignStatus::Open && state.status != CampaignStatus::Funded {
            return Err(Error::FundingClosed);
        }
        if amount <= 0 { return Err(Error::InvalidAmount); }

        let now = env.ledger().timestamp();
        if now > config.deadline { return Err(Error::DeadlinePassed); }

        if state.total_raised >= config.max_funding { return Err(Error::TargetExceeded); }
        let remaining = config.max_funding - state.total_raised;
        if amount > remaining { return Err(Error::TargetExceeded); }

        let next_total = state.total_raised
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let existing = investments.get(investor.clone()).unwrap_or(0);
        let next_investment = existing
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        investments.set(investor.clone(), next_investment);
        env.storage().instance().set(&DataKey::Investments, &investments);

        state.total_raised = next_total;
        if state.status == CampaignStatus::Open
            && state.total_raised >= config.funding_target
        {
            state.status = CampaignStatus::Funded;
            env.events().publish(
                (Symbol::new(&env, "status_changed"), symbol_short!("funded")),
                state.total_raised,
            );
        }
        env.storage().instance().set(&DataKey::State, &state);

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&investor, &env.current_contract_address(), &amount);

        env.events().publish((symbol_short!("invested"), investor), amount);
        Ok(())
    }

    fn refundable_total(total_raised: i128, funding_target: i128) -> Result<i128, Error> {
        if total_raised <= 0 { return Ok(0); }
        if total_raised < funding_target { return Ok(total_raised); }
        total_raised.checked_sub(funding_target).ok_or(Error::InvalidAmount)
    }

    fn refundable_amount(
        total_raised: i128,
        funding_target: i128,
        invested: i128,
    ) -> Result<i128, Error> {
        if total_raised <= 0 || invested <= 0 { return Ok(0); }
        if total_raised <= funding_target { return Ok(invested); }
        let refundable = total_raised
            .checked_sub(funding_target)
            .ok_or(Error::InvalidAmount)?;
        invested
            .checked_mul(refundable)
            .ok_or(Error::InvalidAmount)?
            .checked_div(total_raised)
            .ok_or(Error::InvalidAmount)
    }

    pub fn early_close(env: Env, admin: Address, close_reason: String) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.raise_ended { return Ok(()); }
        if state.status != CampaignStatus::Open
            && state.status != CampaignStatus::Funded
            && state.status != CampaignStatus::Paused
        {
            return Err(Error::FundingClosed);
        }

        let total_refundable = Self::refundable_total(
            state.total_raised,
            config.funding_target,
        )?;
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let mut refundable: Map<Address, i128> = Map::new(&env);
        let mut retained: Map<Address, i128> = Map::new(&env);
        let mut allocated = 0i128;

        for (investor, invested) in investments.iter() {
            if invested <= 0 { continue; }
            let amount = Self::refundable_amount(
                state.total_raised,
                config.funding_target,
                invested,
            )?;
            if amount > 0 {
                refundable.set(investor.clone(), amount);
                allocated = allocated.checked_add(amount).ok_or(Error::InvalidAmount)?;
            }
            let retained_amount = invested
                .checked_sub(amount)
                .ok_or(Error::InvalidAmount)?;
            if retained_amount > 0 {
                retained.set(investor, retained_amount);
            }
        }

        let mut residual = total_refundable
            .checked_sub(allocated)
            .ok_or(Error::InvalidAmount)?;
        if residual > 0 {
            for (investor, invested) in investments.iter() {
                if residual == 0 { break; }
                if invested <= 0 { continue; }
                let current = refundable.get(investor.clone()).unwrap_or(0);
                if current < invested {
                    let next = current.checked_add(1).ok_or(Error::InvalidAmount)?;
                    refundable.set(investor.clone(), next);
                    let retained_amount = invested
                        .checked_sub(next)
                        .ok_or(Error::InvalidAmount)?;
                    if retained_amount > 0 {
                        retained.set(investor, retained_amount);
                    } else {
                        retained.remove(investor);
                    }
                    residual -= 1;
                }
            }
        }
        if residual != 0 { return Err(Error::InvalidAmount); }

        state.total_raised = state.total_raised
            .checked_sub(total_refundable)
            .ok_or(Error::InvalidAmount)?;
        state.raise_ended = true;
        env.storage().instance().set(&DataKey::Investments, &retained);
        env.storage().instance().set(&DataKey::RefundableInvestments, &refundable);
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::CloseReason, &close_reason);
        env.events().publish(
            (Symbol::new(&env, "early_closed"),),
            (close_reason, total_refundable),
        );
        Ok(())
    }

    pub fn approve(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Funded { return Err(Error::NotFunded); }
        state.status = CampaignStatus::Active;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("active")), ());
        Ok(())
    }

    fn is_partial_release_authorized(caller: &Address, config: &Config) -> bool {
        caller == &config.admin || caller == &config.farmer
    }

    fn checked_partial_release_amount(
        total_raised: i128,
        amount_bps: u32,
        cap_bps: u32,
        released_bps: u32,
    ) -> Result<i128, Error> {
        if amount_bps == 0 || amount_bps > cap_bps {
            return Err(Error::InvalidBps);
        }
        let next_total = released_bps
            .checked_add(amount_bps)
            .ok_or(Error::ReleaseCapExceeded)?;
        if next_total > cap_bps {
            return Err(Error::ReleaseCapExceeded);
        }

        let total_raised_i128 = total_raised;
        let bps_i128 = i128::try_from(amount_bps).map_err(|_| Error::InvalidBps)?;
        let release_total = total_raised_i128
            .checked_mul(bps_i128)
            .ok_or(Error::InvalidAmount)?
            .checked_div(10_000)
            .ok_or(Error::InvalidAmount)?;
        Ok(release_total)
    }

    pub fn partial_release_milestone(
        env: Env,
        caller: Address,
        amount_bps: u32,
    ) -> Result<(), Error> {
        caller.require_auth();

        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if !Self::is_partial_release_authorized(&caller, &config) {
            return Err(Error::Unauthorized);
        }

        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.status != CampaignStatus::Active {
            return Err(Error::NotFunded);
        }

        let release_amount = Self::checked_partial_release_amount(
            state.total_raised,
            amount_bps,
            config.partial_release_cap_bps,
            state.partial_release_total_bps,
        )?;

        if release_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let usdc = token::Client::new(&env, &config.usdc_token);
        state.partial_release_total_bps = state
            .partial_release_total_bps
            .checked_add(amount_bps)
            .ok_or(Error::ReleaseCapExceeded)?;
        env.storage().instance().set(&DataKey::State, &state);

        usdc.transfer(
            &env.current_contract_address(),
            &config.farmer,
            &release_amount,
        );

        env.events().publish(
            (Symbol::new(&env, "partial_release"),),
            (amount_bps, release_amount),
        );
        Ok(())
    }

    pub fn release_milestone(env: Env, admin: Address, milestone_index: u32) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Active { return Err(Error::NotFunded); }
        if milestone_index >= config.milestone_count { return Err(Error::MilestoneNotFound); }
        if env.storage().instance().has(&DataKey::MilestoneReleased(milestone_index)) {
            return Err(Error::MilestoneAlreadyDone);
        }
        
        // Check for active dispute on this milestone
        if env.storage().instance().has(&DataKey::Dispute(milestone_index)) {
            return Err(Error::DisputeActive);
        }

        let platform_fee = (state.total_raised * config.platform_fee_bps as i128) / 10_000;
        let farmer_pool  = state.total_raised - platform_fee;
        let tranche      = farmer_pool / config.milestone_count as i128;

        // Lock this milestone before invoking the external transfer so a
        // reentrant call sees it already released and errors out.
        env.storage().instance().set(&DataKey::MilestoneReleased(milestone_index), &true);
        state.milestones_released += 1;
        if state.milestones_released >= config.milestone_count {
            state.status = CampaignStatus::Delivered;
            env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("delivered")), ());
        }
        env.storage().instance().set(&DataKey::State, &state);

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &config.farmer, &tranche);

        env.events().publish((symbol_short!("milestone"), milestone_index), tranche);
        Ok(())
    }

    pub fn distribute_revenue(env: Env, admin: Address, revenue_amount: i128) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.status != CampaignStatus::Delivered { return Err(Error::NotFunded); }
        if env.storage().instance().has(&DataKey::Distributed) { return Err(Error::AlreadyDistributed); }
        if revenue_amount <= 0 { return Err(Error::InvalidAmount); }

        let usdc = token::Client::new(&env, &config.usdc_token);
        let platform_fee  = (revenue_amount * config.platform_fee_bps as i128) / 10_000;
        let investor_pool = revenue_amount - platform_fee;

        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let total_raised = state.total_raised;

        // Lock distribution state before invoking external transfers so a
        // reentrant call sees `Distributed == true` and is rejected immediately.
        env.storage().instance().set(&DataKey::Distributed, &true);
        state.status = CampaignStatus::Completed;
        env.storage().instance().set(&DataKey::State, &state);

        // Iterate directly over the Map for better gas efficiency
        for (investor, invested) in investments.iter() {
            if invested > 0 && total_raised > 0 {
                let share = (investor_pool * invested) / total_raised;
                if share > 0 {
                    usdc.transfer(&env.current_contract_address(), &investor, &share);
                    env.events().publish((symbol_short!("payout"), investor), share);
                }
            }
        }
        if platform_fee > 0 {
            usdc.transfer(&env.current_contract_address(), &config.admin, &platform_fee);
        }

        env.events().publish((symbol_short!("complete"),), revenue_amount);
        Ok(())
    }

    fn claim_refund(
        env: &Env,
        state: &mut State,
        investor: &Address,
    ) -> Result<Option<i128>, Error> {
        let mut refunded: Map<Address, bool> = env.storage().instance()
            .get(&DataKey::Refunded).unwrap_or_else(|| Map::new(env));
        if refunded.get(investor.clone()).unwrap_or(false) {
            return Ok(None);
        }

        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(env));
        let mut refundable: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::RefundableInvestments).unwrap_or_else(|| Map::new(env));
        let amount = if state.raise_ended {
            refundable.get(investor.clone()).unwrap_or(0)
        } else {
            investments.get(investor.clone()).unwrap_or(0)
        };
        if amount <= 0 { return Err(Error::InsufficientFunds); }

        if state.raise_ended {
            refundable.set(investor.clone(), 0);
        } else {
            state.total_raised = state.total_raised
                .checked_sub(amount)
                .ok_or(Error::InvalidAmount)?;
            investments.set(investor.clone(), 0);
        }
        refunded.set(investor.clone(), true);
        env.storage().instance().set(&DataKey::Refunded, &refunded);
        if !state.raise_ended {
            env.storage().instance().set(&DataKey::Investments, &investments);
        }
        env.storage().instance().set(&DataKey::RefundableInvestments, &refundable);
        Ok(Some(amount))
    }

    pub fn refund(env: Env, investor: Address) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let can_refund = state.raise_ended
            || state.status == CampaignStatus::Failed
            || ((state.status == CampaignStatus::Open
                || state.status == CampaignStatus::Paused)
                && now > config.deadline);
        if !can_refund { return Err(Error::RefundNotAllowed); }

        let amount = match Self::claim_refund(&env, &mut state, &investor)? {
            Some(amount) => amount,
            None => return Ok(()),
        };
        env.storage().instance().set(&DataKey::State, &state);
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &investor, &amount);
        env.events().publish((symbol_short!("refund"), investor), amount);
        Ok(())
    }

    pub fn refund_by_admin(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let can_refund = state.raise_ended
            || state.status == CampaignStatus::Failed
            || ((state.status == CampaignStatus::Open
                || state.status == CampaignStatus::Paused)
                && now > config.deadline);
        if !can_refund { return Err(Error::RefundNotAllowed); }

        let amount = match Self::claim_refund(&env, &mut state, &investor)? {
            Some(amount) => amount,
            None => return Ok(()),
        };
        env.storage().instance().set(&DataKey::State, &state);
        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &investor, &amount);
        env.events().publish((symbol_short!("refund"), investor), amount);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended {
            return Err(Error::FundingClosed);
        }
        state.status = CampaignStatus::Paused;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("paused")), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended {
            return Err(Error::FundingClosed);
        }
        state.status = CampaignStatus::Open;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("open")), ());
        Ok(())
    }

    pub fn mark_failed(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended {
            return Err(Error::FundingClosed);
        }
        state.status = CampaignStatus::Failed;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("failed")), ());
        Ok(())
    }

    /// Raise a dispute on a specific milestone
    /// Can be called by admin or farmer
    pub fn raise_dispute(env: Env, caller: Address, milestone_index: u32) -> Result<(), Error> {
        caller.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        
        // Only admin or farmer can raise disputes
        if caller != config.admin && caller != config.farmer {
            return Err(Error::Unauthorized);
        }
        
        if state.status != CampaignStatus::Active { return Err(Error::NotFunded); }
        if milestone_index >= config.milestone_count { return Err(Error::MilestoneNotFound); }
        if env.storage().instance().has(&DataKey::MilestoneReleased(milestone_index)) {
            return Err(Error::MilestoneAlreadyDone);
        }
        if env.storage().instance().has(&DataKey::Dispute(milestone_index)) {
            return Err(Error::DisputeActive);
        }
        
        // Set dispute flag
        env.storage().instance().set(&DataKey::Dispute(milestone_index), &true);
        env.events().publish((Symbol::new(&env, "dispute_raised"), milestone_index), caller);
        Ok(())
    }

    /// Resolve a dispute on a milestone
    /// Can only be called by the arbitrator
    /// approve: true to release milestone, false to deny
    pub fn resolve_dispute(env: Env, arbitrator: Address, milestone_index: u32, approve: bool) -> Result<(), Error> {
        arbitrator.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let stored_arbitrator: Address = env.storage().instance().get(&DataKey::Arbitrator)
            .ok_or(Error::NotInitialized)?;
        
        if arbitrator != stored_arbitrator { return Err(Error::Unauthorized); }
        
        if !env.storage().instance().has(&DataKey::Dispute(milestone_index)) {
            return Err(Error::NoDispute);
        }
        
        // Remove dispute flag
        env.storage().instance().remove(&DataKey::Dispute(milestone_index));
        
        if approve {
            // If approved, release the milestone
            let mut state: State = env.storage().instance().get(&DataKey::State)
                .ok_or(Error::NotInitialized)?;
            
            let platform_fee = (state.total_raised * config.platform_fee_bps as i128) / 10_000;
            let farmer_pool  = state.total_raised - platform_fee;
            let tranche      = farmer_pool / config.milestone_count as i128;

            // Lock this milestone before invoking the external transfer so a
            // reentrant call sees it already released and errors out.
            env.storage().instance().set(&DataKey::MilestoneReleased(milestone_index), &true);
            state.milestones_released += 1;
            if state.milestones_released >= config.milestone_count {
                state.status = CampaignStatus::Delivered;
                env.events().publish((Symbol::new(&env, "status_changed"), symbol_short!("delivered")), ());
            }
            env.storage().instance().set(&DataKey::State, &state);

            let usdc = token::Client::new(&env, &config.usdc_token);
            usdc.transfer(&env.current_contract_address(), &config.farmer, &tranche);

            env.events().publish((symbol_short!("milestone"), milestone_index), tranche);
        }
        
        env.events().publish((Symbol::new(&env, "dispute_resolved"), milestone_index), approve);
        Ok(())
    }

    /// Update the arbitrator address
    /// Can only be called by admin before campaign is funded
    pub fn update_arbitrator(env: Env, admin: Address, new_arbitrator: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        
        // Prevent modification after funding has started
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        if state.raise_ended || state.status != CampaignStatus::Open {
            return Err(Error::Unauthorized);
        }
        
        env.storage().instance().set(&DataKey::Arbitrator, &new_arbitrator);
        env.events().publish((Symbol::new(&env, "arbitrator_updated"),), new_arbitrator);
        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
    }

    pub fn get_state(env: Env) -> Result<State, Error> {
        env.storage().instance().get(&DataKey::State).ok_or(Error::NotInitialized)
    }

    pub fn is_raise_ended(env: Env) -> bool {
        let state: State = match env.storage().instance().get(&DataKey::State) {
            Some(state) => state,
            None => return false,
        };
        let config: Config = match env.storage().instance().get(&DataKey::Config) {
            Some(config) => config,
            None => return state.raise_ended,
        };
        state.raise_ended || env.ledger().timestamp() > config.deadline
    }

    pub fn get_close_reason(env: Env) -> Option<String> {
        env.storage().instance().get(&DataKey::CloseReason)
    }

    pub fn get_refundable_amount(env: Env, investor: Address) -> i128 {
        let refundable: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::RefundableInvestments).unwrap_or_else(|| Map::new(&env));
        refundable.get(investor).unwrap_or(0)
    }

    pub fn get_investment(env: Env, investor: Address) -> i128 {
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        investments.get(investor).unwrap_or(0)
    }

    pub fn get_ownership_pct(env: Env, investor: Address) -> i128 {
        let state: State = match env.storage().instance().get(&DataKey::State) {
            Some(s) => s,
            None => return 0,
        };
        if state.total_raised == 0 { return 0; }
        let investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let invested = investments.get(investor).unwrap_or(0);
        (invested * 10_000) / state.total_raised
    }

    pub fn has_dispute(env: Env, milestone_index: u32) -> bool {
        env.storage().instance().has(&DataKey::Dispute(milestone_index))
    }

    pub fn get_arbitrator(env: Env) -> Result<Address, Error> {
        env.storage().instance().get(&DataKey::Arbitrator).ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_release_amount_respects_cumulative_cap() {
        let total_raised = 100_000_i128;
        let first = FarmCampaignContract::checked_partial_release_amount(
            total_raised,
            2_500,
            9_800,
            0,
        )
        .unwrap();
        assert_eq!(first, 2_500);

        let second = FarmCampaignContract::checked_partial_release_amount(
            total_raised,
            5_000,
            9_800,
            2_500,
        )
        .unwrap();
        assert_eq!(second, 5_000);

        let cumulative = 2_500u32 + 5_000u32;
        assert!(cumulative <= 9_800);
    }

    #[test]
    fn partial_release_amount_reverts_if_cumulative_total_exceeds_cap() {
        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            7_000,
            9_800,
            3_500,
        )
        .unwrap_err();
        assert_eq!(err, Error::ReleaseCapExceeded);
    }

    #[test]
    fn partial_release_amount_reverts_if_bps_are_invalid() {
        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            0,
            9_800,
            0,
        )
        .unwrap_err();
        assert_eq!(err, Error::InvalidBps);

        let err = FarmCampaignContract::checked_partial_release_amount(
            100_000,
            10_001,
            9_800,
            0,
        )
        .unwrap_err();
        assert_eq!(err, Error::InvalidBps);
    }

    #[test]
    fn partial_release_authorization_requires_admin_or_farmer() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let investor = Address::generate(&env);

        let config = Config {
            admin: admin.clone(),
            farmer: farmer.clone(),
            arbitrator: Address::generate(&env),
            usdc_token: Address::generate(&env),
            funding_target: 100_000,
            deadline: 0,
            platform_fee_bps: 200,
            milestone_count: 3,
            partial_release_cap_bps: 9_800,
            project_name: String::from_str(&env, "demo"),
            commodity: String::from_str(&env, "maize"),
            max_funding: 100_000,
        };

        assert!(FarmCampaignContract::is_partial_release_authorized(&admin, &config));
        assert!(FarmCampaignContract::is_partial_release_authorized(&farmer, &config));
        assert!(!FarmCampaignContract::is_partial_release_authorized(&investor, &config));
    }

    use soroban_sdk::testutils::{Address as _, Ledger};

    struct CampaignSetup {
        env: Env,
        contract_id: Address,
        admin: Address,
        usdc_address: Address,
        investor_a: Address,
        investor_b: Address,
    }

    fn setup_campaign(funding_target: i128, max_funding: i128) -> CampaignSetup {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(100);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = env.register_stellar_asset_contract(admin.clone());
        let investor_a = Address::generate(&env);
        let investor_b = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);

        FarmCampaignContractClient::new(&env, &contract_id).initialize_with_max_funding(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &funding_target,
            &max_funding,
            &1000,
            &200,
            &3,
            &9800,
            &String::from_str(&env, "demo"),
            &String::from_str(&env, "maize"),
        );

        CampaignSetup {
            env,
            contract_id,
            admin,
            usdc_address,
            investor_a,
            investor_b,
        }
    }

    impl CampaignSetup {
        fn usdc(&self) -> token::Client<'_> {
            token::Client::new(&self.env, &self.usdc_address)
        }

        fn client(&self) -> FarmCampaignContractClient<'_> {
            FarmCampaignContractClient::new(&self.env, &self.contract_id)
        }
    }

    fn invest(setup: &CampaignSetup, investor: &Address, amount: i128) {
        setup.usdc().mint(investor, &amount);
        setup.client().invest(investor, &amount);
    }

    #[test]
    fn max_funding_rejects_over_cap_without_trimming() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        invest(&setup, &setup.investor_b, 30);

        setup.usdc().mint(&setup.investor_a, &1);
        let balance_before = setup.usdc().balance(&setup.investor_a);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::TargetExceeded)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_before);
        assert_eq!(setup.client().get_state().total_raised, 150);
    }

    #[test]
    fn early_close_refunds_underfunded_contributions_in_full() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 30);
        invest(&setup, &setup.investor_b, 40);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "campaign cancelled"),
        );

        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            30,
        );
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_b),
            40,
        );

        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 30);
        setup.client().refund_by_admin(&setup.admin, &setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 40);
    }

    #[test]
    fn early_close_refunds_only_the_surplus_pro_rata() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 60);
        invest(&setup, &setup.investor_b, 60);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            10,
        );
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_b),
            10,
        );
        assert_eq!(setup.client().get_state().total_raised, 100);
        assert_eq!(setup.client().get_investment(&setup.investor_a), 50);
        assert_eq!(setup.client().get_investment(&setup.investor_b), 50);

        setup.client().refund(&setup.investor_a);
        setup.client().refund(&setup.investor_b);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 10);
        assert_eq!(setup.usdc().balance(&setup.investor_b), 10);
    }

    #[test]
    fn duplicate_early_close_is_an_idempotent_no_op() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        let reason = String::from_str(&setup.env, "first reason");

        setup.client().early_close(&setup.admin, &reason);
        let refundable_before = setup.client().get_refundable_amount(&setup.investor_a);
        let result = setup.client().try_early_close(
            &setup.admin,
            &String::from_str(&setup.env, "second reason"),
        );

        assert_eq!(result, Ok(Ok(())));
        assert!(setup.client().is_raise_ended());
        assert_eq!(setup.client().get_close_reason(), Some(reason));
        assert_eq!(
            setup.client().get_refundable_amount(&setup.investor_a),
            refundable_before,
        );
    }

    #[test]
    fn early_close_preserves_retained_investments_after_residual_allocation() {
        let setup = setup_campaign(1, 2);
        invest(&setup, &setup.investor_a, 1);
        invest(&setup, &setup.investor_b, 1);

        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        let retained = setup.client().get_investment(&setup.investor_a)
            + setup.client().get_investment(&setup.investor_b);
        assert_eq!(setup.client().get_state().total_raised, 1);
        assert_eq!(retained, 1);
    }

    #[test]
    fn refunds_are_not_repeated_after_early_close() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 120);
        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        setup.client().refund(&setup.investor_a);
        let balance_after_first = setup.usdc().balance(&setup.investor_a);
        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_after_first);
    }

    #[test]
    fn invest_is_rejected_after_early_close() {
        let setup = setup_campaign(100, 150);
        setup.client().early_close(
            &setup.admin,
            &String::from_str(&setup.env, "raise closed"),
        );

        setup.usdc().mint(&setup.investor_a, &1);
        let balance_before = setup.usdc().balance(&setup.investor_a);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::FundingClosed)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), balance_before);
    }

    #[test]
    fn invest_is_rejected_after_the_raise_deadline() {
        let setup = setup_campaign(100, 150);
        setup.env.ledger().set_timestamp(1001);
        setup.usdc().mint(&setup.investor_a, &1);
        let result = setup.client().try_invest(&setup.investor_a, &1);
        assert_eq!(result, Err(Ok(Error::DeadlinePassed)));
        assert_eq!(setup.usdc().balance(&setup.investor_a), 1);
    }

    #[test]
    fn underfunded_raise_allows_full_refund_after_the_deadline() {
        let setup = setup_campaign(100, 150);
        invest(&setup, &setup.investor_a, 30);
        setup.env.ledger().set_timestamp(1001);

        setup.client().refund(&setup.investor_a);
        assert_eq!(setup.usdc().balance(&setup.investor_a), 30);
        assert_eq!(setup.client().get_state().total_raised, 0);
    }

    #[test]
    fn max_funding_cannot_be_below_the_target() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);
        let client = FarmCampaignContractClient::new(&env, &contract_id);

        let result = client.try_initialize_with_max_funding(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &100,
            &99,
            &1000,
            &200,
            &3,
            &9800,
            &String::from_str(&env, "demo"),
            &String::from_str(&env, "maize"),
        );

        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn legacy_initialize_defaults_the_cap_to_the_target() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);
        let arbitrator = Address::generate(&env);
        let usdc_address = Address::generate(&env);
        let contract_id = env.register_contract(None, FarmCampaignContract);

        let client = FarmCampaignContractClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &farmer,
            &arbitrator,
            &usdc_address,
            &100,
            &1000,
            &200,
            &3,
            &9800,
            &String::from_str(&env, "demo"),
            &String::from_str(&env, "maize"),
        );

        assert_eq!(client.get_config().max_funding, 100);
    }
}
