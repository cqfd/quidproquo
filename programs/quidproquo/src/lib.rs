use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{Mint, Token, TokenAccount},
};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod quidproquo {
    use super::*;

    // Make a binding offer of `offer_maker_amount` of one kind of tokens in
    // exchange for `offer_taker_amount` of some other kind of tokens. This
    // will store the offer maker's tokens in an escrow account.
    pub fn make(
        ctx: Context<Make>,
        escrowed_maker_tokens_bump: u8,
        offer_maker_amount: u64,
        offer_taker_amount: u64,
    ) -> ProgramResult {
        // Store some state about the offer being made. We'll need this later if
        // the offer gets accepted or cancelled.
        let offer = &mut ctx.accounts.offer;
        offer.maker = ctx.accounts.offer_maker.key();
        offer.taker_mint = ctx.accounts.taker_mint.key();
        offer.taker_amount = offer_taker_amount;
        offer.escrowed_maker_tokens_bump = escrowed_maker_tokens_bump;

        // Transfer the maker's tokens to the escrow account.
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.offer_makers_maker_tokens.to_account_info(),
                    to: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                    // The offer_maker had to sign from the client
                    authority: ctx.accounts.offer_maker.to_account_info(),
                },
            ),
            offer_maker_amount,
        )
    }

    // Accept an offer by providing the right amount + kind of tokens. This
    // unlocks the tokens escrowed by the offer maker.
    pub fn accept(ctx: Context<Accept>) -> ProgramResult {
        // Transfer the taker's tokens to the maker.
        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    // Don't need to worry about the accepter sneakily providing
                    // the wrong kind of tokens because we've already checked
                    // that while deriving Accounts for the Accept struct.
                    from: ctx.accounts.offer_takers_taker_tokens.to_account_info(),
                    to: ctx.accounts.offer_makers_taker_tokens.to_account_info(),
                    // The offer_taker had to sign from the client
                    authority: ctx.accounts.offer_taker.to_account_info(),
                },
            ),
            // The necessary amount was set by the offer maker.
            ctx.accounts.offer.taker_amount,
        )?;

        // Transfer the maker's tokens (the ones they escrowed) to the taker.
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                    to: ctx.accounts.offer_takers_maker_tokens.to_account_info(),
                    // Cute trick: the escrowed_maker_tokens is its own
                    // authority/owner (and a PDA, so our program can sign for
                    // it just below)
                    authority: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                },
                &[&[
                    ctx.accounts.offer.key().as_ref(),
                    &[ctx.accounts.offer.escrowed_maker_tokens_bump],
                ]],
            ),
            // The amount here is just the entire balance of the escrow account.
            ctx.accounts.escrowed_maker_tokens.amount,
        )?;

        // Finally, close the escrow account and refund the maker (they paid for
        // its rent-exemption).
        anchor_spl::token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::CloseAccount {
                account: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                destination: ctx.accounts.offer_maker.to_account_info(),
                authority: ctx.accounts.escrowed_maker_tokens.to_account_info(),
            },
            &[&[
                ctx.accounts.offer.key().as_ref(),
                &[ctx.accounts.offer.escrowed_maker_tokens_bump],
            ]],
        ))
    }

    pub fn cancel(ctx: Context<Cancel>) -> ProgramResult {
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                    to: ctx.accounts.offer_makers_maker_tokens.to_account_info(),
                    // Cute trick: the escrowed_maker_tokens is its own
                    // authority/owner (and a PDA, so our program can sign for
                    // it just below)
                    authority: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                },
                &[&[
                    ctx.accounts.offer.key().as_ref(),
                    &[ctx.accounts.offer.escrowed_maker_tokens_bump],
                ]],
            ),
            ctx.accounts.escrowed_maker_tokens.amount,
        )?;

        // Close the escrow's token account and refund the maker (they paid for
        // its rent-exemption).
        anchor_spl::token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::CloseAccount {
                account: ctx.accounts.escrowed_maker_tokens.to_account_info(),
                destination: ctx.accounts.offer_maker.to_account_info(),
                authority: ctx.accounts.escrowed_maker_tokens.to_account_info(),
            },
            &[&[
                ctx.accounts.offer.key().as_ref(),
                &[ctx.accounts.offer.escrowed_maker_tokens_bump],
            ]],
        ))
    }
}

#[account]
pub struct Offer {
    // We store the offer maker's key so that they can cancel the offer (we need
    // to know who should sign).
    pub maker: Pubkey,

    // What kind of tokens does the offer maker want in return, and how many of
    // them?
    pub taker_mint: Pubkey,
    pub taker_amount: u64,

    // When the maker makes their offer, we store their offered tokens in an
    // escrow account that lives at a program-derived address, with seeds given
    // by the `Offer` account's address. Storing the corresponding bump here
    // means the client doesn't have to keep passing it.
    pub escrowed_maker_tokens_bump: u8,
}

#[derive(Accounts)]
#[instruction(escrowed_maker_tokens_bump: u8)]
pub struct Make<'info> {
    #[account(init, payer = offer_maker, space = 8 + 32 + 32 + 8 + 1)]
    pub offer: Account<'info, Offer>,

    #[account(mut)]
    pub offer_maker: Signer<'info>,
    #[account(mut, constraint = offer_makers_maker_tokens.mint == maker_mint.key())]
    pub offer_makers_maker_tokens: Account<'info, TokenAccount>,

    // This is where we'll store the offer maker's tokens.
    #[account(
        init,
        payer = offer_maker,
        seeds = [offer.key().as_ref()],
        bump = escrowed_maker_tokens_bump,
        token::mint = maker_mint,
        // We want the program itself to have authority over the escrow token
        // account, so we need to use some program-derived address here. Well,
        // the escrow token account itself already lives at a program-derived
        // address, so we can set its authority to be its own address.
        token::authority = escrowed_maker_tokens,
    )]
    pub escrowed_maker_tokens: Account<'info, TokenAccount>,

    pub maker_mint: Account<'info, Mint>,
    pub taker_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Accept<'info> {
    #[account(
        mut,
        // make sure the offer_maker account really is whoever made the offer!
        constraint = offer.maker == *offer_maker.key,
        // at the end of the instruction, close the offer account (don't need it
        // anymore) and send its rent back to the offer_maker
        close = offer_maker
    )]
    pub offer: Account<'info, Offer>,

    #[account(mut)]
    pub escrowed_maker_tokens: Account<'info, TokenAccount>,

    pub offer_maker: AccountInfo<'info>,
    pub offer_taker: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = taker_mint,
        associated_token::authority = offer_maker,
    )]
    pub offer_makers_taker_tokens: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        // double check that the offer_taker is putting up the right kind of
        // tokens!
        constraint = offer_takers_taker_tokens.mint == offer.taker_mint
    )]
    pub offer_takers_taker_tokens: Account<'info, TokenAccount>,
    #[account(mut)]
    pub offer_takers_maker_tokens: Account<'info, TokenAccount>,

    #[account(address = offer.taker_mint)]
    pub taker_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(
        mut,
        // make sure the offer_maker account really is whoever made the offer!
        constraint = offer.maker == *offer_maker.key,
        // at the end of the instruction, close the offer account (don't need it
        // anymore) and send its rent lamports back to the offer_maker
        close = offer_maker
    )]
    pub offer: Account<'info, Offer>,

    #[account(mut)]
    // the offer_maker needs to sign if they really want to cancel their offer
    pub offer_maker: Signer<'info>,

    #[account(mut)]
    // this is where to send the previously-escrowed tokens to
    pub offer_makers_maker_tokens: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [offer.key().as_ref()],
        bump = offer.escrowed_maker_tokens_bump
    )]
    pub escrowed_maker_tokens: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
