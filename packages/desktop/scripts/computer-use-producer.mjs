/**
 * OpenZWork 保留上游调用形式，CUA 后端固定不可用。
 * 原实现向父目录扫描 producer，会因本机残留包恢复已取消的构建路径；空占位不读取文件。
 * 产品边界见 docs/spec/cua-placeholder-boundary.md。
 */
export function readComputerUseProducer(_options = {}) {
  return { installed: false, placeholder: true };
}

export function isRealComputerUseProducerInstalled(_options = {}) {
  return false;
}
