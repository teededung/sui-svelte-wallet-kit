import { fromBase64 } from '@mysten/sui/utils';
import type { SuiWalletAdapter, SuiAccount } from '../types.js';
import type { ConnectionStatus } from '@suiet/wallet-sdk';

export type SessionContext = {
	getAccount: () => SuiAccount | undefined;
	getAdapter: () => SuiWalletAdapter | undefined;
	getChain: (zkLoginGoogle: any) => string;
	getStatus: () => ConnectionStatus;
	ensureCallable: () => void;
};

const normalizeSignedTx = (res: any): { signature: string; bytes: Uint8Array } => {
	if (!res) throw new Error('Empty signTransaction result');
	const sig = res?.signature;
	const b = res?.bytes;
	if (typeof sig !== 'string' || !sig) throw new Error('Missing signature');
	if (b instanceof Uint8Array) return { signature: sig, bytes: b };
	if (typeof b === 'string' && b) return { signature: sig, bytes: fromBase64(b) };
	const legacy = res?.transactionBlockBytes;
	if (typeof legacy === 'string' && legacy) return { signature: sig, bytes: fromBase64(legacy) };
	throw new Error('Missing bytes');
};

export const signAndExecuteTransaction = async (
	transaction: any,
	session: SessionContext,
	zkLoginGoogle: any
): Promise<any> => {
	session.ensureCallable();
	const acct = session.getAccount();
	if (!acct) throw new Error('No account connected');
	const chain =
		Array.isArray(acct?.chains) && acct.chains[0]
			? acct.chains[0]
			: session.getChain(zkLoginGoogle);
	try {
		if (transaction && typeof transaction.setSender === 'function') {
			transaction.setSender(acct.address);
		}
	} catch {}
	const walletAdapter = session.getAdapter();
	if (typeof walletAdapter?.signAndExecuteTransaction === 'function') {
		return await walletAdapter.signAndExecuteTransaction({ account: acct, chain, transaction });
	}
	const featTx = walletAdapter?.features?.['sui:signAndExecuteTransaction'];
	if (featTx && typeof featTx.signAndExecuteTransaction === 'function') {
		return await featTx.signAndExecuteTransaction({ account: acct, chain, transaction });
	}
	const featTxB = walletAdapter?.features?.['sui:signAndExecuteTransactionBlock'];
	if (featTxB && typeof featTxB.signAndExecuteTransactionBlock === 'function') {
		return await featTxB.signAndExecuteTransactionBlock({
			account: acct,
			chain,
			transactionBlock: transaction
		});
	}
	throw new Error('This wallet does not support signAndExecuteTransaction.');
};

export const signTransaction = async (
	transaction: any,
	options: { sender?: string } = {},
	session: SessionContext,
	zkLoginGoogle: any
): Promise<{ signature: string; bytes: Uint8Array }> => {
	session.ensureCallable();
	const acct = session.getAccount();
	if (!acct) throw new Error('No account connected');
	const chain =
		Array.isArray(acct?.chains) && acct.chains[0]
			? acct.chains[0]
			: session.getChain(zkLoginGoogle);

	try {
		const sender =
			typeof options?.sender === 'string' && options.sender ? options.sender : acct.address;
		if (transaction && typeof transaction.setSender === 'function') {
			transaction.setSender(sender);
		}
	} catch {}

	const walletAdapter = session.getAdapter();
	if (typeof walletAdapter?.signTransaction === 'function') {
		return normalizeSignedTx(
			await walletAdapter.signTransaction({ account: acct, chain, transaction })
		);
	}
	const feat = walletAdapter?.features?.['sui:signTransaction'] as
		| { signTransaction?: (p: any) => Promise<any> }
		| undefined;
	if (feat && typeof feat.signTransaction === 'function') {
		return normalizeSignedTx(await feat.signTransaction({ account: acct, chain, transaction }));
	}

	throw new Error('This wallet does not support signTransaction.');
};

export const signMessage = async (
	message: string | Uint8Array,
	session: SessionContext,
	zkLoginGoogle: any
): Promise<{ signature: string; messageBytes: string }> => {
	session.ensureCallable();

	const messageBytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;

	const acct = session.getAccount();
	if (!acct) throw new Error('No account connected');
	const chain =
		Array.isArray(acct?.chains) && acct.chains[0]
			? acct.chains[0]
			: session.getChain(zkLoginGoogle);

	const walletAdapter = session.getAdapter();
	const featMsg = walletAdapter?.features?.['sui:signMessage'];
	if (featMsg && typeof featMsg.signMessage === 'function') {
		const result = await featMsg.signMessage({ account: acct, chain, message: messageBytes });
		return {
			signature: result.signature,
			messageBytes: Array.from(messageBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		};
	}

	const featPersonal = walletAdapter?.features?.['sui:signPersonalMessage'];
	if (featPersonal && typeof featPersonal.signPersonalMessage === 'function') {
		const result = await featPersonal.signPersonalMessage({
			account: acct,
			chain,
			message: messageBytes
		});
		return {
			signature: result.signature,
			messageBytes: Array.from(messageBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		};
	}

	if (walletAdapter && typeof walletAdapter.signPersonalMessage === 'function') {
		const result = await walletAdapter.signPersonalMessage({
			account: acct,
			message: messageBytes
		});
		return {
			signature: result.signature,
			messageBytes: Array.from(messageBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		};
	}

	throw new Error(
		'This wallet does not support message signing. Please try a different wallet or use signAndExecuteTransaction instead.'
	);
};

export const canSignMessage = (session: SessionContext): boolean => {
	const status = session.getStatus();
	const walletAdapter = session.getAdapter();
	if (status !== 'connected' || !walletAdapter) {
		return false;
	}

	return (
		(walletAdapter.features &&
			walletAdapter.features['sui:signMessage'] &&
			typeof walletAdapter.features['sui:signMessage'].signMessage === 'function') ||
		(walletAdapter.features &&
			walletAdapter.features['sui:signPersonalMessage'] &&
			typeof walletAdapter.features['sui:signPersonalMessage'].signPersonalMessage ===
				'function') ||
		typeof walletAdapter.signMessage === 'function' ||
		typeof walletAdapter.signPersonalMessage === 'function'
	);
};
