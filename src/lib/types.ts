export interface PaginationMeta {
	current_page: number;
	next_page: number | null;
	prev_page: number | null;
	per_page: number;
	total_pages: number;
	total_count: number;
	has_more_pages: boolean;
}

export interface Paginated<T> {
	data: T[];
	meta: PaginationMeta;
}

export interface MarkdownContent {
	markdown: string;
	html: string;
	plain: string;
}

export interface EmbeddedUser {
	id: number;
	type: 'User';
	name: string;
	slug: string;
	username?: string | null;
	avatar: string | null;
	initials: string;
}

export interface EmbeddedGroup {
	id: number;
	type: 'Group';
	name: string;
	slug: string;
	avatar: string | null;
	initials: string;
}

export interface Me extends EmbeddedUser {
	email?: string;
	counts: {
		channels: number;
		followers: number;
		following: number;
		notifications?: number;
	};
}

export interface ImageVersion {
	src: string;
	src_2x: string;
	width: number | null;
	height: number | null;
}

export interface BlockImage {
	alt_text?: string | null;
	blurhash?: string | null;
	width?: number | null;
	height?: number | null;
	src: string;
	aspect_ratio?: number | null;
	content_type: string;
	filename: string;
	file_size?: number | null;
	small: ImageVersion;
	medium: ImageVersion;
	large: ImageVersion;
	square: ImageVersion;
}

export interface BlockSource {
	url: string;
	title?: string | null;
	provider?: { name: string; url: string } | null;
}

export interface BlockEmbed {
	url: string | null;
	type: string | null;
	title: string | null;
	author_name: string | null;
	author_url: string | null;
	source_url: string | null;
	width: number | null;
	height: number | null;
	html: string | null;
	thumbnail_url: string | null;
}

export interface BlockAttachment {
	filename: string | null;
	content_type: string | null;
	file_size: number | null;
	file_extension: string | null;
	url: string;
}


/** Present on blocks/channels returned as part of a channel's contents. */
export interface Connection {
	id: number;
	position: number;
	pinned: boolean;
	connected_at: string;
}

interface BaseBlock {
	id: number;
	connection?: Connection | null;
	base_type: 'Block';
	title: string | null;
	description: MarkdownContent | null;
	state: 'processing' | 'available' | 'failed';
	created_at: string;
	updated_at: string;
	user: EmbeddedUser;
	source?: BlockSource | null;
}

export interface TextBlock extends BaseBlock {
	type: 'Text';
	content: MarkdownContent;
}

export interface ImageBlock extends BaseBlock {
	type: 'Image';
	image: BlockImage;
}

export interface LinkBlock extends BaseBlock {
	type: 'Link';
	image?: BlockImage | null;
	content?: MarkdownContent | null;
}

export interface AttachmentBlock extends BaseBlock {
	type: 'Attachment';
	attachment: BlockAttachment;
	image?: BlockImage | null;
}

export interface EmbedBlock extends BaseBlock {
	type: 'Embed';
	embed: BlockEmbed;
	image?: BlockImage | null;
}

export interface PendingBlock extends BaseBlock {
	type: 'PendingBlock';
}

export type Block = TextBlock | ImageBlock | LinkBlock | AttachmentBlock | EmbedBlock | PendingBlock;

export interface Channel {
	id: number;
	type: 'Channel';
	slug: string;
	title: string;
	description: MarkdownContent | null;
	state: 'available' | 'deleted';
	visibility: 'public' | 'private' | 'closed';
	created_at: string;
	updated_at: string;
	owner: EmbeddedUser | EmbeddedGroup;
	connection?: Connection | null;
	/** Only present when the channel is fetched on its own (not embedded in a list). */
	can?: { add_to: boolean; update: boolean; destroy: boolean; manage_collaborators: boolean } | null;
	counts: {
		blocks: number;
		channels: number;
		contents: number;
		collaborators: number;
	};
}

/** Anything that can live inside a channel. */
export type Connectable = Block | Channel;

export type SortKey = 'position_desc' | 'created_at_desc' | 'created_at_asc';
