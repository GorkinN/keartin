# image-gen/generate.py (улучшенная версия)
import sys
import os
from pathlib import Path

root_dir = Path(__file__).parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

import config

import torch
from diffusers import FluxPipeline
import time
from datetime import datetime

def main():
    print("=" * 70)
    print("🖼️  FLUX.1-dev - Генератор изображений")
    print("=" * 70)
    
    if not torch.cuda.is_available():
        print("❌ GPU не найден!")
        return
    
    print(f"✓ GPU: {torch.cuda.get_device_name(0)}")
    print(f"✓ VRAM: {torch.cuda.get_device_properties(0).total_memory / 1e9:.1f} GB")
    print(f"✓ PyTorch: {torch.__version__}")
    
    torch.cuda.empty_cache()
    
    # Загрузка модели
    print("\n📥 Загрузка FLUX.1-dev...")
    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=torch.bfloat16
    )
    pipe.enable_model_cpu_offload()
    print("✓ Модель загружена")
    
    base_output_dir = Path(__file__).parent / "image_output"
    base_output_dir.mkdir(exist_ok=True)
    
    while True:
        print("\n" + "=" * 70)
        prompt = input("🎨 Введите описание (или 'q'): ").strip()
        
        if prompt.lower() == 'q':
            break
        
        if not prompt:
            prompt = "A cat holding a sign that says hello world"
        
       # Размер
        print("\n📐 РАЗМЕР")
        print("   1. 512x512 (~30 сек)")
        print("   2. 768x768 (~1-2 мин)")
        print("   3. 1024x1024 (~3-5 мин)")
        print("   4. 1536x1536 (~5-10 мин)")
        print("   5. 2048x2048 (~10-20 мин, может не хватить памяти)")

        choice = input("   Выбор (1-5, Enter=1): ").strip()

        if choice == "2":
            width, height = 768, 768
        elif choice == "3":
            width, height = 1024, 1024
        elif choice == "4":
            width, height = 1536, 1536
        elif choice == "5":
            width, height = 2048, 2048
        else:
            width, height = 512, 512

        print(f"   ✓ Размер: {width}x{height}")
        
        # Количество
        try:
            num_files = int(input("\n📁 Сколько изображений? (Enter=1): ") or 1)
            num_files = max(1, min(num_files, 20))
        except ValueError:
            num_files = 1
        
        # Шаги
        try:
            num_steps = int(input("\n⚙️ Шагов (Enter=50): ") or 50)
            num_steps = max(10, min(num_steps, 50))
        except ValueError:
            num_steps = 50
        
        # Создание папки
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_prompt = "".join(c for c in prompt[:30] if c.isalnum() or c in " -_").strip().replace(" ", "_")
        output_folder = base_output_dir / f"{timestamp}_{safe_prompt}"
        output_folder.mkdir(exist_ok=True)
        
        # Информация
        with open(output_folder / "prompt_info.txt", "w", encoding="utf-8") as f:
            f.write(f"Prompt: {prompt}\n")
            f.write(f"Size: {width}x{height}\n")
            f.write(f"Steps: {num_steps}\n")
            f.write(f"Files: {num_files}\n")
            f.write(f"Model: FLUX.1-dev\n")
            f.write(f"Date: {datetime.now()}\n")
        
        print(f"\n🎨 Генерация: {prompt}")
        print(f"📐 Размер: {width}x{height}")
        print(f"📁 Файлов: {num_files}")
        print(f"⚙️ Шагов: {num_steps}")
        print(f"📂 Папка: {output_folder.name}")
        
        # Генерация
        successful = 0
        total_time = 0
        
        for i in range(1, num_files + 1):
            print(f"\n[{i}/{num_files}] Генерация...")
            print("  " + "█" * 0 + "░" * 50, end="\r")
            
            start_time = time.time()
            
            try:
                seed = int(time.time() * 1000) + i * 1000
                generator = torch.Generator("cpu").manual_seed(seed)
                
                image = pipe(
                    prompt,
                    height=height,
                    width=width,
                    guidance_scale=3.5,
                    num_inference_steps=num_steps,
                    max_sequence_length=512 if width >= 1024 else 256,
                    generator=generator,
                ).images[0]
                
                elapsed = time.time() - start_time
                total_time += elapsed
                
                output_path = output_folder / f"variation_{i:03d}.png"
                image.save(output_path)
                
                successful += 1
                
                file_size = output_path.stat().st_size / 1024 / 1024
                print(f"  ✅ variation_{i:03d}.png ({file_size:.1f} MB, {elapsed:.1f} сек)")
                
                torch.cuda.empty_cache()
                
            except Exception as e:
                print(f"  ❌ Ошибка: {e}")
                torch.cuda.empty_cache()
        
        # Итоги
        print(f"\n{'=' * 70}")
        print("✅ ГОТОВО")
        print(f"{'=' * 70}")
        print(f"📁 Успешно: {successful}/{num_files}")
        if successful > 0:
            avg_time = total_time / successful
            print(f"⏱️ Среднее время: {avg_time:.1f} сек/изображение")
            print(f"⏱️ Общее время: {total_time:.1f} сек ({total_time/60:.1f} мин)")
        print(f"📂 Папка: {output_folder}")
        
        cont = input("\nСоздать еще? (y/n): ").strip().lower()
        if cont != 'y':
            break
    
    print("\n👋 До свидания!")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️ Прервано")
    except Exception as e:
        print(f"\n❌ Ошибка: {e}")
        import traceback
        traceback.print_exc()