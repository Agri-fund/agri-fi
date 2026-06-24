//! FarmCampaign Soroban Smart Contract
//!
//! Each farming project deploys one instance of this contract.
//! Manages investment acceptance, escrow locking, milestone-based releases,
//! automated revenue distribution, emergency pause, and refunds.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, Map, String, Vec, token,
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
}

#[contracttype]
pub enum DataKey {
    Config,
    State,
    Investments,
    MilestoneReleased(u32),
    Distributed,
}

#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub admin: Address,
    pub farmer: Address,
    pub usdc_token: Address,
    pub funding_target: i128,
    pub deadline: u64,
    pub platform_fee_bps: u32,
    pub milestone_count: u32,
    pub project_name: String,
    pub commodity: String,
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
}

#[contract]
pub struct FarmCampaignContract;

#[contractimpl]
impl FarmCampaignContract {

    pub fn initialize(
        env: Env,
        admin: Address,
        farmer: Address,
        usdc_token: Address,
        funding_target: i128,
        deadline: u64,
        platform_fee_bps: u32,
        milestone_count: u32,
        project_name: String,
        commodity: String,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        if funding_target <= 0 {
            return Err(Error::InvalidAmount);
        }
        let config = Config {
            admin, farmer, usdc_token, funding_target, deadline,
            platform_fee_bps, milestone_count, project_name, commodity,
        };
        let state = State {
            status: CampaignStatus::Open,
            total_raised: 0,
            milestones_released: 0,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::State, &state);
        env.storage().instance().set(&DataKey::Investments, &Map::<Address, i128>::new(&env));
        Ok(())
    }

    pub fn invest(env: Env, investor: Address, amount: i128) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        if state.status == CampaignStatus::Paused { return Err(Error::Paused); }
        if state.status != CampaignStatus::Open   { return Err(Error::FundingClosed); }
        if amount <= 0                             { return Err(Error::InvalidAmount); }

        let now = env.ledger().timestamp();
        if now > config.deadline { return Err(Error::DeadlinePassed); }

        let remaining = config.funding_target - state.total_raised;
        if amount > remaining { return Err(Error::TargetExceeded); }

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&investor, &env.current_contract_address(), &amount);

        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let existing = investments.get(investor.clone()).unwrap_or(0);
        investments.set(investor.clone(), existing + amount);
        env.storage().instance().set(&DataKey::Investments, &investments);

        state.total_raised += amount;
        if state.total_raised >= config.funding_target {
            state.status = CampaignStatus::Funded;
            env.events().publish((symbol_short!("funded"), investor.clone()), state.total_raised);
        }
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("invested"), investor), amount);
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
        env.events().publish((symbol_short!("approved"),), ());
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

        let platform_fee = (state.total_raised * config.platform_fee_bps as i128) / 10_000;
        let farmer_pool  = state.total_raised - platform_fee;
        let tranche      = farmer_pool / config.milestone_count as i128;

        let usdc = token::Client::new(&env, &config.usdc_token);
        usdc.transfer(&env.current_contract_address(), &config.farmer, &tranche);

        env.storage().instance().set(&DataKey::MilestoneReleased(milestone_index), &true);
        state.milestones_released += 1;
        if state.milestones_released >= config.milestone_count {
            state.status = CampaignStatus::Delivered;
        }
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("milestone"), milestone_index), tranche);
        Ok(())
    }

    pub fn distribute_revenue(env: Env, admin: Address, revenue_amount: i128) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let state: State = env.storage().instance().get(&DataKey::State)
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
        let investors: Vec<Address> = investments.keys();

        for investor in investors.iter() {
            let invested = investments.get(investor.clone()).unwrap_or(0);
            if invested > 0 && total_raised > 0 {
                let share = (investor_pool * invested) / total_raised;
                if share > 0 {
                    usdc.transfer(&env.current_contract_address(), &investor, &share);
                    env.events().publish((symbol_short!("payout"), investor.clone()), share);
                }
            }
        }
        if platform_fee > 0 {
            usdc.transfer(&env.current_contract_address(), &config.admin, &platform_fee);
        }

        env.storage().instance().set(&DataKey::Distributed, &true);
        let mut final_state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        final_state.status = CampaignStatus::Completed;
        env.storage().instance().set(&DataKey::State, &final_state);
        env.events().publish((symbol_short!("complete"),), revenue_amount);
        Ok(())
    }

    pub fn refund(env: Env, investor: Address) -> Result<(), Error> {
        investor.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        let state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;

        let now = env.ledger().timestamp();
        let can_refund = state.status == CampaignStatus::Failed
            || (state.status == CampaignStatus::Open && now > config.deadline);
        if !can_refund { return Err(Error::RefundNotAllowed); }

        let mut investments: Map<Address, i128> = env.storage().instance()
            .get(&DataKey::Investments).unwrap_or_else(|| Map::new(&env));
        let amount = investments.get(investor.clone()).unwrap_or(0);
        if amount <= 0 { return Err(Error::InsufficientFunds); }

        investments.set(investor.clone(), 0);
        env.storage().instance().set(&DataKey::Investments, &investments);

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
        state.status = CampaignStatus::Paused;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        state.status = CampaignStatus::Open;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    pub fn mark_failed(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config)
            .ok_or(Error::NotInitialized)?;
        if admin != config.admin { return Err(Error::Unauthorized); }
        let mut state: State = env.storage().instance().get(&DataKey::State)
            .ok_or(Error::NotInitialized)?;
        state.status = CampaignStatus::Failed;
        env.storage().instance().set(&DataKey::State, &state);
        env.events().publish((symbol_short!("failed"),), ());
        Ok(())
    }

    // ── Read-only views ───────────────────────────────────────────────────────

    pub fn get_config(env: Env) -> Result<Config, Error> {
        env.storage().instance().get(&DataKey::Config).ok_or(Error::NotInitialized)
    }

    pub fn get_state(env: Env) -> Result<State, Error> {
        env.storage().instance().get(&DataKey::State).ok_or(Error::NotInitialized)
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
}
