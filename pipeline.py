#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=======================================================================
动态壁纸一键生成流水线（默认 16:10 4K）
=======================================================================
功能:
1. 根据目标宽高比居中裁切底图
2. 调用内置 Real-ESRGAN Vulkan 超分工具，默认启用 TTA
3. 使用 Lanczos 缩放至目标尺寸，默认 3840×2400
4. 从最终底图生成环境配色，并写出名称、分辨率和说明一致的独立网页工程
"""

import os
import sys
import argparse
import colorsys
import html
import json
import re
import subprocess
import webbrowser
from PIL import Image

if sys.platform == "win32":
    import io
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(CURRENT_DIR, "input")
OUTPUT_DIR = os.path.join(CURRENT_DIR, "output")
TOOLS_DIR = os.path.join(CURRENT_DIR, "tools")
REAL_ESRGAN_EXE = os.path.join(TOOLS_DIR, "realesrgan-ncnn-vulkan.exe")
TEMPLATE_DIR = os.path.join(CURRENT_DIR, "sample_sakura_wallpaper")

DEFAULT_TARGET_W = 3840
DEFAULT_TARGET_H = 2400
DEFAULT_EFFECT_COLOR = "#b8d9f2"
EFFECT_THEME_PATTERN = re.compile(
    r'(<script id="effect-theme" type="application/json">)(.*?)(</script>)',
    re.DOTALL,
)
PROJECT_INFO_PATTERN = re.compile(
    r'(<!-- 壁纸工程信息：开始 -->)(.*?)(<!-- 壁纸工程信息：结束 -->)',
    re.DOTALL,
)
PROJECT_FILES = ("index.html", "wallpaper.js", "project.json", "README.md")

def project_title(project_name, width, height):
    return f"{project_name} - {width}×{height} 交互式动态壁纸"

def replace_project_html(content, project_name, width, height):
    """按 HTML 上下文转义名称，保留自动配色块及其余网页内容。"""
    replacements = (
        (r'(\bdata-project-name=")[^"]*(")', html.escape(project_name, quote=True)),
        (r'(<title>).*?(</title>)', html.escape(project_title(project_name, width, height))),
        (r'(<span id="wallpaper-project-name">).*?(</span>)', html.escape(project_name)),
    )
    for pattern, value in replacements:
        content, count = re.subn(
            pattern, lambda match: match.group(1) + value + match.group(2), content, flags=re.DOTALL,
        )
        if count != 1:
            raise ValueError("网页工程信息标记缺失或重复，请升级模板。")
    return content

def replace_project_readme(content, project_name, width, height):
    """只替换工程信息段，公共使用说明保持可直接导入和迁移。"""
    if len(list(PROJECT_INFO_PATTERN.finditer(content))) != 1:
        raise ValueError("README.md 必须包含唯一的壁纸工程信息段，请升级模板。")
    newline = "\r\n" if "\r\n" in content else "\n"
    escaped_name = re.sub(r'([\\`*_{}\[\]()#+.!|<>])', r'\\\1', project_name)
    details = (
        f"# {escaped_name} - {width}×{height} 交互式动态壁纸" + newline + newline
        + f"本目录为独立网页壁纸工程，使用本目录内的 [bg.png](bg.png)，背景分辨率为 {width} × {height}。"
    )
    return PROJECT_INFO_PATTERN.sub(
        lambda match: match.group(1) + newline + details + newline + match.group(3), content, count=1,
    )

def render_project_file(filename, content, project_name, width, height):
    if filename == "index.html":
        return replace_project_html(content, project_name, width, height)
    if filename == "project.json":
        project = json.loads(content)
        project["title"] = project_title(project_name, width, height)
        project["description"] = (
            f"{project_name}（{width}×{height}）交互式动态壁纸：环境自动配色、慢速花瓣、星尘、"
            "点击互动、2.5D 视差及网页面板 RGB 输入与手动选色。"
        )
        return json.dumps(project, ensure_ascii=False, indent=2) + "\n"
    if filename == "README.md":
        return replace_project_readme(content, project_name, width, height)
    return content

def extract_effect_theme(img_pil):
    """优先参考外圈环境色；颜色统计不等同于人物与背景分割。"""
    sample = img_pil.convert("RGB")
    sample.thumbnail((160, 160), Image.Resampling.LANCZOS)
    width, height = sample.size
    buckets = [[0.0, 0.0, 0.0, 0.0] for _ in range(24)]
    total_weight = colored_weight = brightness_sum = 0.0
    pixels = sample.load()

    for index in range(width * height):
        pixel = pixels[index % width, index // width]
        x, y = index % width + 0.5, index // width + 0.5
        outer = x < width * 0.25 or x >= width * 0.75 or y < height * 0.25 or y >= height * 0.75
        weight = 3.0 if outer else 1.0
        red, green, blue = (channel / 255.0 for channel in pixel)
        brightness = 0.2126 * red + 0.7152 * green + 0.0722 * blue
        total_weight += weight
        brightness_sum += brightness * weight
        hue, saturation, _ = colorsys.rgb_to_hsv(red, green, blue)
        if saturation < 0.15 or brightness <= 0.025 or brightness >= 0.95:
            continue

        # 极暗或近白细节降低贡献，避免少量噪点决定整张图的特效颜色。
        color_weight = weight * min(1.0, brightness / 0.15, (1.0 - brightness) / 0.15)
        colored_weight += color_weight
        bucket = buckets[min(23, int(hue * 24))]
        bucket[0] += color_weight
        bucket[1] += red * color_weight
        bucket[2] += green * color_weight
        bucket[3] += blue * color_weight

    primary_color = DEFAULT_EFFECT_COLOR
    if colored_weight >= total_weight * 0.15:
        weight, red, green, blue = max(buckets, key=lambda bucket: bucket[0])
        hue, lightness, saturation = colorsys.rgb_to_hls(red / weight, green / weight, blue / weight)
        color = colorsys.hls_to_rgb(hue, max(0.68, min(0.82, lightness)), max(0.25, min(0.65, saturation)))
        primary_color = "#" + "".join(f"{round(channel * 255):02x}" for channel in color)

    return {"primaryColor": primary_color, "brightness": round(brightness_sum / total_weight, 5)}

def replace_effect_theme(content, theme):
    """只替换唯一配色数据块，保留其余网页内容与换行风格。"""
    if len(list(EFFECT_THEME_PATTERN.finditer(content))) != 1:
        raise ValueError("index.html 必须包含唯一的 effect-theme 配色数据块，请先升级壁纸模板。")
    newline = "\r\n" if "\r\n" in content else "\n"
    payload = json.dumps(theme, ensure_ascii=False)
    return EFFECT_THEME_PATTERN.sub(
        lambda match: match.group(1) + newline + "    " + payload + newline + "  " + match.group(3),
        content,
        count=1,
    )

def refresh_effect_theme(project_dir):
    """读取已有底图更新配色，不接入超分、打包或浏览器预览流程。"""
    html_path = os.path.join(project_dir, "index.html")
    with open(html_path, "r", encoding="utf-8", newline="") as rf:
        content = rf.read()
    with Image.open(os.path.join(project_dir, "bg.png")) as background:
        theme = extract_effect_theme(background)
    content = replace_effect_theme(content, theme)
    with open(html_path, "w", encoding="utf-8", newline="") as wf:
        wf.write(content)
    print(f"已刷新自动特效配色：{html_path}（主色 {theme['primaryColor']}）")

def fit_to_aspect_ratio(img_pil, target_aspect=1.6):
    """
    按目标比例居中裁切，默认 16:10；比例差小于 0.01 时跳过预裁切。
    """
    w, h = img_pil.size
    current_aspect = w / float(h)
    
    # 比例差小于 0.01 时跳过预裁切，随后按目标尺寸缩放。
    if abs(current_aspect - target_aspect) < 0.01:
        return img_pil

    if current_aspect > target_aspect:
        # 过宽 (如 16:9 = 1.778)，从左右两侧居中裁切多余区域
        new_w = int(h * target_aspect)
        offset_x = (w - new_w) // 2
        print(f"  [画幅调整] 宽度 {w} → {new_w}，偏移 {offset_x}，目标比例 {target_aspect:.4f}")
        return img_pil.crop((offset_x, 0, offset_x + new_w, h))
    else:
        # 过高 (如 4:3 = 1.333)，从上下两侧居中裁切多余区域
        new_h = int(w / target_aspect)
        offset_y = (h - new_h) // 2
        print(f"  [画幅调整] 高度 {h} → {new_h}，偏移 {offset_y}，目标比例 {target_aspect:.4f}")
        return img_pil.crop((0, offset_y, w, offset_y + new_h))

def process_single_image(image_path, target_w=DEFAULT_TARGET_W, target_h=DEFAULT_TARGET_H, model_name="realesr-animevideov3", use_tta=True, style="natural", open_preview=True, output_dir=OUTPUT_DIR):
    if style != "natural":
        raise ValueError("film 风格尚未实现，目前仅支持 natural；底图未处理。")
    if target_w <= 0 or target_h <= 0:
        raise ValueError("目标宽度和高度必须为正整数。")
    for filename in PROJECT_FILES:
        if not os.path.isfile(os.path.join(TEMPLATE_DIR, filename)):
            raise FileNotFoundError(f"缺少必要的工程模板：{filename}")
    base_name = os.path.splitext(os.path.basename(image_path))[0]
    out_project_dir = os.path.join(output_dir, f"{base_name}_4k_wallpaper")
    os.makedirs(out_project_dir, exist_ok=True)
    
    print("\n" + "="*65)
    print(f"正在处理：{os.path.basename(image_path)}")
    print(f"目标：{target_w} × {target_h} | 模型：{model_name} | 风格：{style}")
    print("="*65)

    # 1. 载入图片并按目标比例裁切
    raw_img = Image.open(image_path).convert("RGBA")
    w_raw, h_raw = raw_img.size
    
    # 将透明区域合成到白色背景。
    bg_clean = Image.new("RGB", (w_raw, h_raw), (255, 255, 255))
    bg_clean.paste(raw_img, mask=raw_img.split()[3])
    
    target_aspect = target_w / float(target_h)
    fitted_img = fit_to_aspect_ratio(bg_clean, target_aspect=target_aspect)

    # 2. 按宽度阈值缩小超分输入；该规则不判断图像质量。
    temp_in = os.path.join(TOOLS_DIR, f"temp_{base_name}_in.png")
    temp_out = os.path.join(TOOLS_DIR, f"temp_{base_name}_out.png")

    fw, fh = fitted_img.size
    if fw > 2000:
        base_prep = fitted_img.resize((1920, int(1920 / target_aspect)), Image.Resampling.LANCZOS)
    else:
        base_prep = fitted_img
    base_prep.save(temp_in)

    # 3. 运行 GPU 神经网络超分 (Real-ESRGAN Vulkan)
    print(f"  [GPU 超分] Real-ESRGAN 4x，模型 {model_name}，TTA={use_tta}")
    cmd = [
        REAL_ESRGAN_EXE,
        "-i", temp_in,
        "-o", temp_out,
        "-n", model_name,
        "-s", "4"
    ]
    if use_tta:
        cmd.append("-x")

    subprocess.run(cmd, cwd=TOOLS_DIR, check=True)

    # 4. 将超分结果缩放至目标尺寸
    print(f"  [尺寸调整] Lanczos 缩放至 {target_w} × {target_h}")
    sr_img = Image.open(temp_out)
    final_4k = sr_img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # 清理临时文件
    if os.path.exists(temp_in): os.remove(temp_in)
    if os.path.exists(temp_out): os.remove(temp_out)

    # 5. 保存底图到壁纸工程目录
    dst_bg_path = os.path.join(out_project_dir, "bg.png")
    final_4k.save(dst_bg_path, compress_level=3)
    print(f"  [输出] 底图已保存：{dst_bg_path}")

    # 6. 自动组装交互式 Web 动态壁纸工程包
    print("  [工程组装] 写入网页、脚本、配置及说明...")
    effect_theme = extract_effect_theme(final_4k)
    project_contents = {}
    for f in PROJECT_FILES:
        src_template_file = os.path.join(TEMPLATE_DIR, f)
        with open(src_template_file, "r", encoding="utf-8") as rf:
            content = rf.read()
        content = render_project_file(f, content, base_name, target_w, target_h)
        if f == "index.html":
            content = replace_effect_theme(content, effect_theme)
        project_contents[f] = content
    # 全部模板解析成功后再写入，避免缺失模板被跳过却宣称完整组装成功。
    for f, content in project_contents.items():
        with open(os.path.join(out_project_dir, f), "w", encoding="utf-8") as wf:
            wf.write(content)

    print(f"\n>>> 动态壁纸工程已生成：{out_project_dir}")
    preview_html = os.path.join(out_project_dir, "index.html")

    if open_preview:
        print(f">>> 正在打开浏览器预览壁纸: {preview_html}")
        webbrowser.open(f"file:///{os.path.abspath(preview_html)}")

    return out_project_dir

def main():
    parser = argparse.ArgumentParser(description="动态壁纸生成流水线，默认 3840×2400（16:10 4K）")
    parser.add_argument("--input", "-i", type=str, default=INPUT_DIR, help="输入图片路径或文件夹 (默认 input 目录)")
    parser.add_argument("--output", "-o", type=str, default=OUTPUT_DIR, help="输出目录")
    parser.add_argument("--width", "-W", type=int, default=DEFAULT_TARGET_W, help="目标宽度 (默认 3840)")
    parser.add_argument("--height", "-H", type=int, default=DEFAULT_TARGET_H, help="目标高度 (默认 2400)")
    parser.add_argument("--model", "-m", type=str, default="realesr-animevideov3", choices=["realesr-animevideov3", "realesrgan-x4plus-anime", "realesrgan-x4plus"], help="超分模型名称")
    parser.add_argument("--no-tta", action="store_true", help="关闭默认启用的 TTA 模式")
    parser.add_argument("--style", "-s", type=str, default="natural", choices=["natural", "film"], help="目前仅支持 natural；film 为兼容旧命令保留，使用时明确报错")
    parser.add_argument("--no-browser", action="store_true", help="处理完成后不自动打开浏览器预览")
    parser.add_argument("--refresh-theme", type=str, metavar="工程目录", help="仅从工程内已有 bg.png 刷新 HTML 配色，不运行超分或预览")
    args = parser.parse_args()

    if args.style != "natural":
        parser.error("film 风格尚未实现，目前仅支持 natural；未生成或修改底图。")
    if args.width <= 0 or args.height <= 0:
        parser.error("目标宽度和高度必须为正整数。")

    if args.refresh_theme is not None:
        try:
            refresh_effect_theme(args.refresh_theme)
        except (OSError, ValueError) as exc:
            parser.exit(1, f"刷新配色失败：{exc}\n")
        return

    # 确定输入图片列表
    images = []
    if os.path.isfile(args.input):
        images.append(args.input)
    elif os.path.isdir(args.input):
        exts = [".jpg", ".jpeg", ".png", ".webp", ".bmp"]
        for root, _, files in os.walk(args.input):
            for f in files:
                if any(f.lower().endswith(ext) for ext in exts):
                    images.append(os.path.join(root, f))
    
    if not images:
        print(f"提示: 未在 {args.input} 找到待处理的图片文件。")
        print("请将待处理的图片放入 input/ 文件夹后重新运行，或指定 -i 参数！")
        return

    print(f"找到 {len(images)} 张图片待处理...")
    for idx, img_path in enumerate(images):
        process_single_image(
            img_path,
            target_w=args.width,
            target_h=args.height,
            model_name=args.model,
            use_tta=not args.no_tta,
            style=args.style,
            open_preview=not args.no_browser and (idx == 0), # 仅预览首张
            output_dir=args.output,
        )

if __name__ == "__main__":
    main()
