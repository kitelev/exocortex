import { IFileSystemAdapter } from "exocortex";
export declare class NodeFsAdapter implements IFileSystemAdapter {
    private rootPath;
    constructor(rootPath: string);
    readFile(filePath: string): Promise<string>;
    fileExists(filePath: string): Promise<boolean>;
    getFileMetadata(filePath: string): Promise<Record<string, any>>;
    createFile(filePath: string, content: string): Promise<string>;
    updateFile(filePath: string, content: string): Promise<void>;
    writeFile(filePath: string, content: string): Promise<void>;
    deleteFile(filePath: string): Promise<void>;
    renameFile(oldPath: string, newPath: string): Promise<void>;
    createDirectory(dirPath: string): Promise<void>;
    directoryExists(dirPath: string): Promise<boolean>;
    getMarkdownFiles(rootPath?: string): Promise<string[]>;
    findFilesByMetadata(query: Record<string, any>): Promise<string[]>;
    findFileByUID(uid: string): Promise<string | null>;
    private resolvePath;
    private extractFrontmatter;
    private matchesQuery;
    private normalizeValue;
}
//# sourceMappingURL=NodeFsAdapter.d.ts.map