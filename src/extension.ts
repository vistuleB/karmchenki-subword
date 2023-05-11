import * as vscode from 'vscode';
import { AssertionError } from 'assert';


function is_alphanumeric(str: string, xtra_chars?: string): boolean {
	if (str.length === 0) { return false; }
	for (let i = 0; i < str.length; i++) {
		if (xtra_chars && xtra_chars.includes(str[i])) { return true; }
		const code = str.charCodeAt(i);
		if (!(code > 47 && code < 58) && // numeric (0-9)
			!(code > 64 && code < 91) && // upper alpha (A-Z)
			!(code > 96 && code < 123) && // lower alpha (a-z)
			!(code === 45 || code === 95)) {
			return false;
		}
	}
	return true;
}

function find_end_or_beginning_of_word_you_tell_me(doc: vscode.TextDocument, pos: vscode.Position, delta: number, xtra_chars?: string): vscode.Position {
	if (delta !== 1 && delta !== -1) { throw new AssertionError(); }
	let prev_pos = pos;
	let next_pos = pos;
	while (true) {
		if (prev_pos.character === 0 && delta < 0) { break; }
		next_pos = prev_pos.translate({ characterDelta: delta, lineDelta: 0 });
		const word = doc.getText(new vscode.Range(prev_pos, next_pos));
		if (!is_alphanumeric(word, xtra_chars)) { break; }
		prev_pos = next_pos;
	}
	return prev_pos;
}

function find_end_of_word(doc: vscode.TextDocument, pos: vscode.Position, xtra_chars?: string): vscode.Position {
	return find_end_or_beginning_of_word_you_tell_me(doc, pos, 1, xtra_chars);
}

function find_beginning_of_word(doc: vscode.TextDocument, pos: vscode.Position, xtra_chars?: string): vscode.Position {
	return find_end_or_beginning_of_word_you_tell_me(doc, pos, -1, xtra_chars);
}

function extend_to_word(doc: vscode.TextDocument, pos: vscode.Position, xtra_chars?: string) {
	let beginning = find_beginning_of_word(doc, pos, xtra_chars);
	let end = find_end_of_word(doc, pos, xtra_chars);
	return new vscode.Range(beginning, end);
}

function character_left_of_offset(doc: vscode.TextDocument, offset: number) {
	const prev_pos = doc.positionAt(offset - 1);
	const next_pos = doc.positionAt(offset);
	const char = doc.getText(new vscode.Range(prev_pos, next_pos));
	if (char.length !== 1 && offset > 0) {
		throw new AssertionError();
	}
	return char;
}

function character_right_of_offset(doc: vscode.TextDocument, offset: number) {
	const prev_pos = doc.positionAt(offset);
	const next_pos = doc.positionAt(offset + 1);
	return doc.getText(new vscode.Range(prev_pos, next_pos));
}

function move_left_past_spaces(doc: vscode.TextDocument, pos: vscode.Position) {
	let offset = doc.offsetAt(pos);
	const first_char = character_left_of_offset(doc, offset);
	if (!' \t|&'.includes(first_char)) { return doc.positionAt(offset - 1); }
	do {
		offset -= 1;
	} while (character_left_of_offset(doc, offset) === first_char);
	return doc.positionAt(offset);
}

function move_right_past_spaces(doc: vscode.TextDocument, pos: vscode.Position) {
	let offset = doc.offsetAt(pos);
	const first_char = character_right_of_offset(doc, offset);
	if (first_char.length === 0) { return pos; }
	if (!' \t|&'.includes(first_char)) { return doc.positionAt(offset + 1); }
	do {
		offset += 1;
	} while (character_right_of_offset(doc, offset) === first_char);
	return doc.positionAt(offset);
}

function is_hexadecimal_string(s: string) {
	for (let i = 0; i < s.length; i++) {
		if (!"0123456789abcdefABCDEF".includes(s[i])) { return false; }
	}
	return true;
}

const UPPERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÉÈÊÀÓÒŽŠ';
const NUMBERS = '0123456789';

function is_subword_breakpoint(word: string, i: number): boolean {
	if (i <= 0 || i >= word.length) { throw new AssertionError(); }
	const prev_char = word.substr(i - 1, 1);
	const next_char = word.substr(i, 1);
	if (prev_char.length !== 1) { throw new AssertionError(); }
	if (next_char.length !== 1) { throw new AssertionError(); }
	return (
		(!UPPERS.includes(prev_char) && UPPERS.includes(next_char)) ||
		(NUMBERS.includes(prev_char) !== NUMBERS.includes(next_char)) ||
		('_'.includes(prev_char) !== '_'.includes(next_char)) ||
		('-'.includes(prev_char) !== '-'.includes(next_char))
	);
}

vscode.Position.prototype.isBeforeOrEqual = function (other: vscode.Position): boolean {
	return this.isBefore(other) || this.isEqual(other);
};

vscode.Position.prototype.isAfterOrEqual = function (other: vscode.Position): boolean {
	return this.isAfter(other) || this.isEqual(other);
};

function previous_character(doc: vscode.TextDocument, pos: vscode.Position): string {
	const pos_offset = doc.offsetAt(pos);
	if (pos_offset === 0) { return ''; }
	const prev_pos = doc.positionAt(pos_offset - 1);
	return doc.getText(new vscode.Range(prev_pos, pos));
}

function move_position_subword_left(doc: vscode.TextDocument, pos: vscode.Position) {
	const range = extend_to_word(doc, pos);
	const word = doc.getText(range);

	if (range.start.isEqual(pos)) {
		return move_left_past_spaces(doc, pos);
	}

	if (previous_character(doc, range.start) === '#' && is_hexadecimal_string(word)) {
		return range.start;
	}

	const pos_offset = doc.offsetAt(pos);
	const range_start_offset = doc.offsetAt(range.start);

	for (let i = pos_offset - 1 - range_start_offset; i > 0; i--) {
		if (is_subword_breakpoint(word, i)) {
			return doc.positionAt(range_start_offset + i);
		}
	}

	return range.start;
}

function move_position_subword_right(doc: vscode.TextDocument, pos: vscode.Position) {
	const range = extend_to_word(doc, pos);
	const word = doc.getText(range);

	if (range.end.isEqual(pos)) { return move_right_past_spaces(doc, pos); }

	if (previous_character(doc, range.start) === '#' && is_hexadecimal_string(word)) {
		return range.end;
	}

	const pos_offset = doc.offsetAt(pos);
	const range_start_offset = doc.offsetAt(range.start);

	for (let i = pos_offset + 1 - range_start_offset; i < word.length; i++) {
		if (is_subword_breakpoint(word, i)) {
			return doc.positionAt(range_start_offset + i);
		}
	}

	return range.end;
}

function move_subword_left(editor: vscode.TextEditor, extend: boolean) {
	const new_selections: vscode.Selection[] = [];
	editor.selections.forEach(s => {
		const new_active = move_position_subword_left(editor.document, s.active);
		const new_anchor = (extend) ? s.anchor : new_active;
		new_selections.push(new vscode.Selection(new_anchor, new_active));
	});
	editor.selections = new_selections;
}

function move_subword_right(editor: vscode.TextEditor, extend: boolean) {
	const new_selections: vscode.Selection[] = [];
	editor.selections.forEach(s => {
		const new_active = move_position_subword_right(editor.document, s.active);
		const new_anchor = (extend) ? s.anchor : new_active;
		new_selections.push(new vscode.Selection(new_anchor, new_active));
	});
	editor.selections = new_selections;
}

function moveSubwordLeftExtend(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	move_subword_left(editor, true);
}

function moveSubwordLeftNoExtend(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	move_subword_left(editor, false);
}

function moveSubwordRightExtend(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	move_subword_right(editor, true);
}

function moveSubwordRightNoExtend(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	move_subword_right(editor, false);
}

function deleteSubwordLeft(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	if (editor.selections.every(s => s.isEmpty)) { move_subword_left(editor, true); }
	editor.selections.forEach(s => edit.delete(s));
}

function deleteSubwordRight(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	if (editor.selections.every(s => s.isEmpty)) { move_subword_right(editor, true); }
	editor.selections.forEach(s => edit.delete(s));
}

function dropSelections(editor: vscode.TextEditor, edit: vscode.TextEditorEdit) {
	editor.selections = editor.selections.map(s => new vscode.Selection(s.active, s.active));
}

function selection_is_inverted(s: vscode.Selection) {
	return s.active.isBefore(s.anchor);
}

function selection_is_non_inverted(s: vscode.Selection) {
	return s.active.isAfter(s.anchor);
}

function set_context(property_name: string, value: boolean) {
	vscode.commands.executeCommand('setContext', property_name, value);
}

vscode.window.onDidChangeTextEditorSelection(
	(e: vscode.TextEditorSelectionChangeEvent) => {
		set_context('existsInvertedSelection', e.selections.some(s => selection_is_inverted(s)));
		set_context('existsNonInvertedSelection', e.selections.some(s => selection_is_non_inverted(s)));
	}
);

interface VanillaCommand {
	name: string;
	func: (p1: vscode.TextEditor, p2: vscode.TextEditorEdit) => void;
}

function register_commands(extension_id: string, context: vscode.ExtensionContext, ze_list: VanillaCommand[]) {
	ze_list.forEach(z => vscode.commands.registerTextEditorCommand(extension_id + '.' + z.name, z.func));
}

export function activate(context: vscode.ExtensionContext) {
	register_commands(
		'karmchenki-subword',
		context,
		[
			{ name: 'moveSubwordLeftExtend', func: moveSubwordLeftExtend },
			{ name: 'moveSubwordRightExtend', func: moveSubwordRightExtend },
			{ name: 'moveSubwordLeftNoExtend', func: moveSubwordLeftNoExtend },
			{ name: 'moveSubwordRightNoExtend', func: moveSubwordRightNoExtend },
			{ name: 'deleteSubwordLeft', func: deleteSubwordLeft },
			{ name: 'deleteSubwordRight', func: deleteSubwordRight },
			{ name: 'dropSelections', func: dropSelections }
		]
	);
}

export function deactivate() { }
