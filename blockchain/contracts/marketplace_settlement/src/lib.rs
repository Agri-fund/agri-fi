//! MarketplaceSettlement Soroban Smart Contract
//! Buyer → escrow → farmer + investors + platform settlement.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, contracterror, symbol_short,
    Address, Env, String, Vec, token,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized       = 1,
    OrderNotFound      = 2,
    OrderAlreadyExists = 3,
    InvalidAmount      = 4,
    InvalidState       = 5,
    NotInitialized     = 6,
    AlreadyInitialized = 7,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum OrderStatus {
    Pending,
    Completed,
    Refunded,
}

#[contracttype]
pub enum DataKey {
    Admin,
    UsdcToken,
    PlatformFeeBps,
    Order(String),
    OrderCount,
}

#[contracttype]
#[derive(Clone)]
pub struct InvestorShare {
    pub investor: Address,
    pub share_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct Order {
    pub order_id: String,
    pub buyer: Address,
    pub farmer: Address,
    pub amount: i128,
    pub platform_fee_bps: u32,
    pub status: OrderStatus,
    pub created_at: u64,
    pub investor_shares: Vec<InvestorShare>,
}

#[contract]
pub struct MarketplaceSettlementContract;

#[contractimpl]
impl MarketplaceSettlementContract {

    pub fn initialize(
        env: Env,
        admin: Address,
        usdc_token: Address,
        platform_fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::UsdcToken, &usdc_token);
        env.storage().instance().set(&DataKey::PlatformFeeBps, &platform_fee_bps);
        env.storage().instance().set(&DataKey::OrderCount, &0u32);
        Ok(())
    }

    pub fn create_order(
        env: Env,
        buyer: Address,
        order_id: String,
        farmer: Address,
        amount: i128,
        investor_shares: Vec<InvestorShare>,
    ) -> Result<(), Error> {
        buyer.require_auth();
        if amount <= 0 { return Err(Error::InvalidAmount); }

        let key = DataKey::Order(order_id.clone());
        if env.storage().instance().has(&key) { return Err(Error::OrderAlreadyExists); }

        let total_investor_bps: u32 = investor_shares.iter().map(|s| s.share_bps).sum();
        if total_investor_bps > 9_800 { return Err(Error::InvalidAmount); }

        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken)
            .ok_or(Error::NotInitialized)?;
        let platform_fee_bps: u32 = env.storage().instance()
            .get(&DataKey::PlatformFeeBps).unwrap_or(200);

        let usdc = token::Client::new(&env, &usdc_token);
        usdc.transfer(&buyer, &env.current_contract_address(), &amount);

        let order = Order {
            order_id: order_id.clone(),
            buyer: buyer.clone(),
            farmer,
            amount,
            platform_fee_bps,
            status: OrderStatus::Pending,
            created_at: env.ledger().timestamp(),
            investor_shares,
        };
        env.storage().instance().set(&key, &order);

        let count: u32 = env.storage().instance().get(&DataKey::OrderCount).unwrap_or(0);
        env.storage().instance().set(&DataKey::OrderCount, &(count + 1));
        env.events().publish((symbol_short!("order"), buyer), amount);
        Ok(())
    }

    pub fn confirm_delivery(env: Env, admin: Address, order_id: String) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }

        let key = DataKey::Order(order_id.clone());
        let mut order: Order = env.storage().instance().get(&key)
            .ok_or(Error::OrderNotFound)?;
        if order.status != OrderStatus::Pending { return Err(Error::InvalidState); }

        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken)
            .ok_or(Error::NotInitialized)?;
        let usdc = token::Client::new(&env, &usdc_token);
        let total = order.amount;

        let platform_fee  = (total * order.platform_fee_bps as i128) / 10_000;
        let distributable = total - platform_fee;

        let total_investor_bps: u32 = order.investor_shares.iter().map(|s| s.share_bps).sum();
        let investor_pool = if total_investor_bps > 0 {
            (distributable * total_investor_bps as i128) / 10_000
        } else {
            0
        };
        let farmer_amount = distributable - investor_pool;

        if farmer_amount > 0 {
            usdc.transfer(&env.current_contract_address(), &order.farmer, &farmer_amount);
        }

        let mut paid_to_investors: i128 = 0;
        let inv_count = order.investor_shares.len();
        for (i, share) in order.investor_shares.iter().enumerate() {
            let inv_amount = if i == (inv_count as usize) - 1 {
                investor_pool - paid_to_investors
            } else if total_investor_bps > 0 {
                (investor_pool * share.share_bps as i128) / total_investor_bps as i128
            } else {
                0
            };
            if inv_amount > 0 {
                usdc.transfer(&env.current_contract_address(), &share.investor, &inv_amount);
                paid_to_investors += inv_amount;
            }
        }

        if platform_fee > 0 {
            usdc.transfer(&env.current_contract_address(), &stored_admin, &platform_fee);
        }

        order.status = OrderStatus::Completed;
        env.storage().instance().set(&key, &order);
        env.events().publish((symbol_short!("settled"), order_id), total);
        Ok(())
    }

    pub fn refund_buyer(env: Env, admin: Address, order_id: String) -> Result<(), Error> {
        admin.require_auth();
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored_admin { return Err(Error::Unauthorized); }

        let key = DataKey::Order(order_id.clone());
        let mut order: Order = env.storage().instance().get(&key)
            .ok_or(Error::OrderNotFound)?;
        if order.status != OrderStatus::Pending { return Err(Error::InvalidState); }

        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken)
            .ok_or(Error::NotInitialized)?;
        let usdc = token::Client::new(&env, &usdc_token);
        usdc.transfer(&env.current_contract_address(), &order.buyer, &order.amount);

        order.status = OrderStatus::Refunded;
        env.storage().instance().set(&key, &order);
        env.events().publish((symbol_short!("refund"), order_id), order.amount);
        Ok(())
    }

    pub fn get_order(env: Env, order_id: String) -> Result<Order, Error> {
        env.storage().instance().get(&DataKey::Order(order_id)).ok_or(Error::OrderNotFound)
    }

    pub fn get_order_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::OrderCount).unwrap_or(0)
    }
}
