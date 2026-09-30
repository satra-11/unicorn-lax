from torchvision import models
import os
import urllib.request
import torch 
import torchvision.models as models
from onnxruntime.quantization import quantize_dynamic, QuantType

def main():
    weight_url = 'http://places2.csail.mit.edu/models_places365/resnet18_places365.pth.tar'
    weight_path = 'resnet18_places365.pth.tar'
    category_url = 'https://raw.githubusercontent.com/csailvision/places365/master/categories_places365.txt'
    category_path = 'categories_places365.txt'

    if not os.path.exists(weight_path):    
        urllib.request.urlretrieve(weight_url, weight_path)
    if not os.path.exists(category_path):
        urllib.request.urlretrieve(category_url, category_path)
    model = models.resnet18(num_classes=365)

    checkpoint = torch.load(weight_path, map_location='cpu')
    state_dict = {str.replace(k,'module.', ''): v for k,v in checkpoint['state_dict'].items() }
    model.load_state_dict(state_dict)

    model.eval()

    fp32_onnx_path = 'place365_resnet18_fp32.onnx'
    dummy_inputs = torch.randn(1,3,244,244)

    torch.onnx.export(
        model,
        dummy_inputs,
        fp32_onnx_path,
        export_params= True,
        opset_version = 18,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output']
    )

if __name__ == "__main__":
    main()
