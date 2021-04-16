import {
  contexts,
  createTokenAccount,
  findOrCreateAccountByMint,
  LENDING_PROGRAM_ID,
  models,
  notify,
  ParsedAccount,
  TOKEN_PROGRAM_ID,
  TokenAccount,
} from '@oyster/common';
import { AccountLayout, NATIVE_MINT, Token } from '@solana/spl-token';
import {
  Account,
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  Obligation,
  refreshReserveInstruction,
  repayObligationLiquidityInstruction,
  Reserve,
} from '../models';

const { approve } = models;
const { sendTransaction } = contexts.Connection;

// @FIXME
export const repayObligationLiquidity = async (
  from: TokenAccount,
  repayAmount: number,

  // which loan to repay
  obligation: ParsedAccount<Obligation>,

  repayReserve: ParsedAccount<Reserve>,

  withdrawReserve: ParsedAccount<Reserve>,

  connection: Connection,
  wallet: any,
) => {
  notify({
    message: 'Repaying funds...',
    description: 'Please review transactions to approve.',
    type: 'warn',
  });

  // user from account
  const signers: Account[] = [];
  const instructions: TransactionInstruction[] = [];
  const cleanupInstructions: TransactionInstruction[] = [];

  const accountRentExempt = await connection.getMinimumBalanceForRentExemption(
    AccountLayout.span,
  );

  const [lendingMarketAuthority] = await PublicKey.findProgramAddress(
    [repayReserve.info.lendingMarket.toBuffer()],
    LENDING_PROGRAM_ID,
  );

  let fromAccount = from.pubkey;
  if (
    wallet.publicKey.equals(fromAccount) &&
    repayReserve.info.liquidity.mint.equals(NATIVE_MINT)
  ) {
    fromAccount = createTokenAccount(
      instructions,
      wallet.publicKey,
      accountRentExempt + repayAmount,
      NATIVE_MINT,
      wallet.publicKey,
      signers,
    );
    cleanupInstructions.push(
      Token.createCloseAccountInstruction(
        TOKEN_PROGRAM_ID,
        fromAccount,
        wallet.publicKey,
        wallet.publicKey,
        [],
      ),
    );
  }

  // create approval for transfer transactions
  const transferAuthority = approve(
    instructions,
    cleanupInstructions,
    fromAccount,
    wallet.publicKey,
    repayAmount,
  );
  signers.push(transferAuthority);

  // get destination account
  const toAccount = await findOrCreateAccountByMint(
    wallet.publicKey,
    wallet.publicKey,
    instructions,
    cleanupInstructions,
    accountRentExempt,
    withdrawReserve.info.collateral.mint,
    signers,
  );

  // @FIXME: obligation tokens
  // create approval for transfer transactions
  approve(
    instructions,
    cleanupInstructions,
    obligationToken.pubkey,
    wallet.publicKey,
    obligationToken.info.amount.toNumber(),
    true,
    // reuse transfer authority
    transferAuthority.publicKey,
  );

  instructions.push(
    // @FIXME: aggregator needed
    refreshReserveInstruction(repayReserve.pubkey),
    refreshReserveInstruction(withdrawReserve.pubkey),
  );

  instructions.push(
    repayObligationLiquidityInstruction(
      repayAmount,
      fromAccount,
      toAccount,
      repayReserve.pubkey,
      obligation.pubkey,
      repayReserve.info.lendingMarket,
      lendingMarketAuthority,
      transferAuthority.publicKey,
    ),
  );

  let { txid }  = await sendTransaction(
    connection,
    wallet,
    instructions.concat(cleanupInstructions),
    signers,
    true,
  );

  notify({
    message: 'Funds repaid.',
    type: 'success',
    description: `Transaction - ${txid}`,
  });
};
